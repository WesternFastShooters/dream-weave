package preview

import (
	"context"
	"errors"
	"regexp"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProcessErrorClassification(t *testing.T) {
	if !IsRetryable(NewProcessError(errors.New("temporary"), true)) {
		t.Fatal("temporary error is not retryable")
	}
	if IsRetryable(NewProcessError(errors.New("permanent"), false)) {
		t.Fatal("permanent error is retryable")
	}
	if IsRetryable(errors.New("plain")) {
		t.Fatal("plain error is retryable")
	}
}

func TestRenewUntilRunsPeriodicallyAndStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls atomic.Int32
	done := renewUntil(ctx, 5*time.Millisecond, func() error {
		if calls.Add(1) == 2 {
			cancel()
		}
		return nil
	}, cancel)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("renew loop did not stop")
	}
	if calls.Load() < 2 {
		t.Fatalf("renew calls = %d, want at least 2", calls.Load())
	}
}

func TestRenewUntilCancelsJobWhenLeaseIsLost(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	leaseLost := errors.New("lease lost")
	done := renewUntil(ctx, time.Millisecond, func() error { return leaseLost }, cancel)
	if err := <-done; !errors.Is(err, leaseLost) {
		t.Fatalf("renew error = %v", err)
	}
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("context error = %v", ctx.Err())
	}
}

func TestFinishSchedulesRetryAfterThirtySeconds(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	worker := &Worker{DB: db, Now: func() time.Time { return now }}
	job := Job{ID: "job", AssetID: "asset", Renderer: "audio-waveform", Attempts: 1}
	mock.ExpectExec(regexp.QuoteMeta("UPDATE preview_jobs SET status='retry_wait',next_attempt_at=$3,lease_expires_at=NULL,error_code=$4,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2")).
		WithArgs(job.ID, job.Attempts, now.Add(30*time.Second), "preview-failed").WillReturnResult(sqlmock.NewResult(0, 1))
	if err := worker.Finish(context.Background(), job, Result{}, errors.New("temporary"), true); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFinishDoesNotRetryPermanentFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	worker := &Worker{DB: db}
	job := Job{ID: "job", AssetID: "asset", Renderer: "video-poster", Attempts: 1}
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE preview_jobs SET status='failed'").WithArgs(job.ID, job.Attempts, "preview-failed").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE preview_artifacts SET status='failed'").WithArgs(job.AssetID, "preview-failed", job.Renderer).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE assets SET processing=jsonb_set").WithArgs(job.AssetID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if err := worker.Finish(context.Background(), job, Result{}, errors.New("invalid media"), false); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFinishMarksJobArtifactAndAssetReadyInOneTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	worker := &Worker{DB: db}
	job := Job{ID: "job", AssetID: "asset", Renderer: "audio-waveform", Attempts: 1}
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE preview_jobs SET status='succeeded',renderer=\\$3").WithArgs(job.ID, job.Attempts, "video-poster").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE preview_artifacts SET renderer=\\$3,status='ready'").WithArgs(job.AssetID, job.Renderer, "video-poster", "derivatives/asset/video-poster.jpg", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE assets SET metadata=metadata").WithArgs(job.AssetID, sqlmock.AnyArg(), "mp4", "video").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if err := worker.Finish(context.Background(), job, Result{ArtifactRef: "derivatives/asset/video-poster.jpg", ArtifactMeta: map[string]any{}, AssetMetadata: map[string]any{"durationMs": 1000}, Format: "mp4", Renderer: "video-poster", AssetKind: "video"}, nil, false); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
