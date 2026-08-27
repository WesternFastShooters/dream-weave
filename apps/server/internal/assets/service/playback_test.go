package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"github.com/dream-weave/dream-weave/apps/server/internal/resourceaccess"
)

type allowAuthorizer struct{ err error }

func (a allowAuthorizer) Require(context.Context, string, string) error { return a.err }

func TestPlaybackAccessIssuesPurposeBoundCapabilityForReadyMedia(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	secret := []byte("01234567890123456789012345678901")
	service := &Service{DB: db, Auth: allowAuthorizer{}, Capabilities: resourceaccess.Signer{Secret: secret}, Now: func() time.Time { return now }, PreviewOrigin: "https://preview.localhost"}
	mock.ExpectQuery("SELECT storage_ref,display_name,kind,processing,metadata FROM assets").WithArgs("asset", "project").
		WillReturnRows(sqlmock.NewRows([]string{"storage_ref", "display_name", "kind", "processing", "metadata"}).AddRow("uploads/source", "tone.mp3", "audio", []byte(`{"state":"ready"}`), []byte(`{}`)))
	access, err := service.Access(context.Background(), "project", "asset", "playback")
	if err != nil {
		t.Fatal(err)
	}
	if access.FileName != "" {
		t.Fatalf("playback file name = %q", access.FileName)
	}
	const prefix = "https://preview.localhost/internal/asset-access/playback/"
	if !strings.HasPrefix(access.URL, prefix) {
		t.Fatalf("URL = %q", access.URL)
	}
	claims, err := (resourceaccess.Signer{Secret: secret}).Verify(strings.TrimPrefix(access.URL, prefix), "playback", "browser", now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.AssetID != "asset" || claims.ExpiresAt != now.Add(5*time.Minute).Unix() {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestPlaybackAccessRejectsWrongKindAndNotReadyMedia(t *testing.T) {
	for _, tc := range []struct {
		name, kind, state, code string
		status                  int
	}{
		{"wrong kind", "image", "ready", "VALIDATION_FAILED", 422},
		{"not ready", "audio", "queued", "ASSET_NOT_READY", 409},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			service := &Service{DB: db, Auth: allowAuthorizer{}, Capabilities: resourceaccess.Signer{Secret: []byte("01234567890123456789012345678901")}}
			mock.ExpectQuery("SELECT storage_ref,display_name,kind,processing,metadata FROM assets").WithArgs("asset", "project").
				WillReturnRows(sqlmock.NewRows([]string{"storage_ref", "display_name", "kind", "processing", "metadata"}).AddRow("uploads/source", "media", tc.kind, []byte(`{"state":"`+tc.state+`"}`), []byte(`{}`)))
			_, err = service.Access(context.Background(), "project", "asset", "playback")
			var apiErr *apierror.Error
			if !errors.As(err, &apiErr) || apiErr.Code != tc.code || apiErr.Status != tc.status {
				t.Fatalf("error = %#v", err)
			}
		})
	}
}

func TestPlaybackAccessRequiresDownloadPermission(t *testing.T) {
	forbidden := apierror.Forbidden()
	service := &Service{Auth: allowAuthorizer{err: forbidden}}
	_, err := service.Access(context.Background(), "project", "asset", "playback")
	if !errors.Is(err, forbidden) {
		t.Fatalf("error = %v", err)
	}
}
