package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/repository"
)

type Authorizer interface {
	Require(context.Context, string, string) error
}
type Service struct {
	Repo *repository.Postgres
	Auth Authorizer
}
type ApplyRequest struct {
	ProjectID        string
	ExpectedRevision int64
	RequestID        string
	Mutations        []mutation.Mutation
}

func (s *Service) Get(ctx context.Context, projectID string) (domain.Snapshot, error) {
	if err := s.Auth.Require(ctx, projectID, "project:read"); err != nil {
		return domain.Snapshot{}, err
	}
	out, err := s.Repo.Snapshot(ctx, s.Repo.DB, projectID)
	if errors.Is(err, sql.ErrNoRows) {
		return out, apierror.NotFound("PROJECT_NOT_FOUND")
	}
	return out, err
}
func (s *Service) Apply(ctx context.Context, req ApplyRequest) (domain.Snapshot, error) {
	if err := s.Auth.Require(ctx, req.ProjectID, "project:write"); err != nil {
		return domain.Snapshot{}, err
	}
	if !mutation.IsUUID(req.RequestID) {
		return domain.Snapshot{}, apierror.Validation("requestId must be a UUID", map[string]string{"requestId": "invalid UUID"})
	}
	if err := mutation.ValidateBatch(req.Mutations); err != nil {
		return domain.Snapshot{}, apierror.Validation(err.Error(), map[string]string{"mutations": "invalid"})
	}
	hash, err := hashRequest(req.ExpectedRevision, req.Mutations)
	if err != nil {
		return domain.Snapshot{}, err
	}
	tx, revision, err := s.Repo.BeginLocked(ctx, req.ProjectID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Snapshot{}, apierror.NotFound("PROJECT_NOT_FOUND")
	}
	if err != nil {
		return domain.Snapshot{}, err
	}
	defer tx.Rollback()
	receipt, err := s.Repo.Receipt(ctx, tx, req.ProjectID, req.RequestID)
	if err != nil {
		return domain.Snapshot{}, err
	}
	if receipt != nil {
		if receipt.Hash != hash {
			return domain.Snapshot{}, apierror.New(422, "REQUEST_ID_REUSED", "requestId was already used with a different payload", map[string]any{"requestId": req.RequestID})
		}
		if err := tx.Rollback(); err != nil {
			return domain.Snapshot{}, err
		}
		return receipt.Snapshot, nil
	}
	if revision != req.ExpectedRevision {
		return domain.Snapshot{}, apierror.Conflict(revision)
	}
	if err := s.Repo.Apply(ctx, tx, req.ProjectID, req.Mutations); err != nil {
		return domain.Snapshot{}, apierror.Validation("invalid mutation", map[string]string{"mutations": err.Error()})
	}
	next := revision + 1
	snapshot, err := s.Repo.Snapshot(ctx, tx, req.ProjectID)
	if err != nil {
		return domain.Snapshot{}, err
	}
	snapshot.Revision = next
	if err := s.Repo.Commit(ctx, tx, req.ProjectID, req.RequestID, hash, next, snapshot); err != nil {
		return domain.Snapshot{}, err
	}
	return snapshot, nil
}
func hashRequest(expectedRevision int64, ms []mutation.Mutation) (string, error) {
	// requestId selects the receipt. The remainder of the command must be
	// identical when that receipt is replayed, including its concurrency guard.
	b, e := json.Marshal(struct {
		ExpectedRevision int64               `json:"expectedRevision"`
		Mutations        []mutation.Mutation `json:"mutations"`
	}{ExpectedRevision: expectedRevision, Mutations: ms})
	if e != nil {
		return "", fmt.Errorf("marshal receipt request: %w", e)
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}
