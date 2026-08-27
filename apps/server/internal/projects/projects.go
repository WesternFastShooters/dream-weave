package projects

import (
	"context"
	"database/sql"
	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
	"strings"
)

type Service struct{ DB *sql.DB }
type Project struct {
	ID      string
	Title   string
	Summary string
	Status  string
	Role    string
}

func (s *Service) Require(ctx context.Context, projectID, permission string) error {
	p, ok := identity.FromContext(ctx)
	if !ok {
		return apierror.New(401, "UNAUTHENTICATED", "authentication required", nil)
	}
	var role, status string
	err := s.DB.QueryRowContext(ctx, `SELECT m.role,p.status FROM project_members m JOIN projects p ON p.id=m.project_id WHERE m.project_id=$1 AND m.user_id=$2`, projectID, p.ID).Scan(&role, &status)
	if err == sql.ErrNoRows {
		return apierror.NotFound("PROJECT_NOT_FOUND")
	}
	if err != nil {
		return err
	}
	if permission == "project:write" && (role == "viewer" || status == "archived") {
		return apierror.Forbidden()
	}
	return nil
}
func (s *Service) Create(ctx context.Context, title, summary string) (Project, error) {
	p, ok := identity.FromContext(ctx)
	if !ok {
		return Project{}, apierror.New(401, "UNAUTHENTICATED", "authentication required", nil)
	}
	if strings.TrimSpace(title) == "" {
		return Project{}, apierror.Validation("title is required", map[string]string{"title": "required"})
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Project{}, e
	}
	defer tx.Rollback()
	var out Project
	e = tx.QueryRowContext(ctx, `INSERT INTO projects(id,title,summary,status,created_by,updated_by) VALUES(gen_random_uuid(),$1,$2,'active',$3,$3) RETURNING id,title,summary,status`, title, summary, p.ID).Scan(&out.ID, &out.Title, &out.Summary, &out.Status)
	if e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'owner')`, out.ID, p.ID); e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO canvas_documents(project_id,revision) VALUES($1,0)`, out.ID); e != nil {
		return out, e
	}
	out.Role = "owner"
	return out, tx.Commit()
}
func (s *Service) Get(ctx context.Context, id string) (Project, error) {
	p, ok := identity.FromContext(ctx)
	if !ok {
		return Project{}, apierror.New(401, "UNAUTHENTICATED", "authentication required", nil)
	}
	var out Project
	e := s.DB.QueryRowContext(ctx, `SELECT p.id,p.title,p.summary,p.status,m.role FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=$1 AND m.user_id=$2`, id, p.ID).Scan(&out.ID, &out.Title, &out.Summary, &out.Status, &out.Role)
	if e == sql.ErrNoRows {
		return out, apierror.NotFound("PROJECT_NOT_FOUND")
	}
	return out, e
}
func (s *Service) UpsertMember(ctx context.Context, projectID, userID, role string) error {
	p, ok := identity.FromContext(ctx)
	if !ok {
		return apierror.New(401, "UNAUTHENTICATED", "authentication required", nil)
	}
	if role != "owner" && role != "editor" && role != "viewer" {
		return apierror.Validation("invalid role", map[string]string{"role": "invalid"})
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// Serialize all membership changes for a project before checking ownership.
	// Locking only the target member leaves two concurrent owner demotions able
	// to observe the same last-owner count.
	var status string
	e = tx.QueryRowContext(ctx, `SELECT status FROM projects WHERE id=$1 FOR UPDATE`, projectID).Scan(&status)
	if e == sql.ErrNoRows {
		return apierror.NotFound("PROJECT_NOT_FOUND")
	}
	if e != nil {
		return e
	}
	if status != "active" {
		return apierror.Validation("project is not active", map[string]string{"projectId": "inactive"})
	}
	var owner bool
	if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND role='owner')`, projectID, p.ID).Scan(&owner); e != nil {
		return e
	}
	if !owner {
		return apierror.Forbidden()
	}
	var prior string
	e = tx.QueryRowContext(ctx, `SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR UPDATE`, projectID, userID).Scan(&prior)
	if e == nil && prior == "owner" && role != "owner" {
		var owners int
		if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'`, projectID).Scan(&owners); e != nil {
			return e
		}
		if owners <= 1 {
			return apierror.Validation("the last owner cannot be changed", map[string]string{"role": "last owner"})
		}
	} else if e != nil && e != sql.ErrNoRows {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role`, projectID, userID, role)
	if e != nil {
		return e
	}
	return tx.Commit()
}
