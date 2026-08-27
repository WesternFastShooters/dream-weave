package preview

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	defaultLeaseDuration = 5 * time.Minute
	defaultRenewInterval = 60 * time.Second
	defaultJobTimeout    = 5 * time.Minute
)

type Job struct {
	ID, AssetID, Renderer string
	Attempts              int
	LeaseExpiresAt        time.Time
}
type Result struct {
	ArtifactRef   string
	ArtifactMeta  map[string]any
	AssetMetadata map[string]any
	// Format is established by the isolated processor (ffprobe for media), not
	// by the upload MIME declaration.
	Format    string
	Renderer  string
	AssetKind string
}

// ProcessError carries the retry decision across the external processor boundary.
// Permanent media validation failures must not consume all four attempts.
type ProcessError struct {
	Err       error
	Retryable bool
}

func (e *ProcessError) Error() string {
	if e.Err == nil {
		return "preview processor failed"
	}
	return e.Err.Error()
}
func (e *ProcessError) Unwrap() error { return e.Err }
func NewProcessError(err error, retryable bool) error {
	return &ProcessError{Err: err, Retryable: retryable}
}
func IsRetryable(err error) bool {
	var processErr *ProcessError
	return errors.As(err, &processErr) && processErr.Retryable
}

type Worker struct {
	DB  *sql.DB
	Now func() time.Time
	// Process must honor context cancellation and return a persisted artifact reference.
	Process       func(context.Context, Job) (Result, error)
	LeaseDuration time.Duration
	RenewInterval time.Duration
	JobTimeout    time.Duration
}

func (w *Worker) now() time.Time {
	if w.Now != nil {
		return w.Now().UTC()
	}
	return time.Now().UTC()
}
func (w *Worker) leaseDuration() time.Duration {
	if w.LeaseDuration > 0 {
		return w.LeaseDuration
	}
	return defaultLeaseDuration
}
func (w *Worker) renewInterval() time.Duration {
	if w.RenewInterval > 0 {
		return w.RenewInterval
	}
	return defaultRenewInterval
}
func (w *Worker) jobTimeout() time.Duration {
	if w.JobTimeout > 0 {
		return w.JobTimeout
	}
	return defaultJobTimeout
}

// Claim uses SKIP LOCKED so multiple workers cannot execute the same artifact concurrently.
func (w *Worker) Claim(ctx context.Context) (*Job, error) {
	tx, err := w.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := w.now()
	if _, err = tx.ExecContext(ctx, `UPDATE preview_jobs SET status='retry_wait',next_attempt_at=$1,lease_expires_at=NULL,updated_at=now() WHERE status='running' AND lease_expires_at < $1`, now); err != nil {
		return nil, err
	}
	job := &Job{}
	err = tx.QueryRowContext(ctx, `SELECT id,asset_id,renderer,attempts FROM preview_jobs WHERE (status='queued' AND attempts < 4) OR (status='retry_wait' AND next_attempt_at <= $1 AND attempts < 4) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&job.ID, &job.AssetID, &job.Renderer, &job.Attempts)
	if err == sql.ErrNoRows {
		return nil, tx.Commit()
	}
	if err != nil {
		return nil, err
	}
	job.Attempts++
	job.LeaseExpiresAt = now.Add(w.leaseDuration())
	result, err := tx.ExecContext(ctx, `UPDATE preview_jobs SET status='running',attempts=$2,lease_expires_at=$3,next_attempt_at=NULL,updated_at=now() WHERE id=$1`, job.ID, job.Attempts, job.LeaseExpiresAt)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, fmt.Errorf("job claim lost")
	}
	return job, tx.Commit()
}

// Renew extends only the attempt that this worker claimed. An older executor can
// never renew a newer attempt after its lease has been recovered.
func (w *Worker) Renew(ctx context.Context, job Job) error {
	result, err := w.DB.ExecContext(ctx, `UPDATE preview_jobs SET lease_expires_at=$3,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2`, job.ID, job.Attempts, w.now().Add(w.leaseDuration()))
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return fmt.Errorf("job lease lost")
	}
	return nil
}

func (w *Worker) Finish(ctx context.Context, job Job, result Result, processErr error, retryable bool) error {
	if processErr == nil {
		if result.ArtifactRef == "" {
			processErr = fmt.Errorf("preview processor returned no artifact reference")
			retryable = false
		} else {
			renderer := job.Renderer
			if result.Renderer != "" {
				if result.Renderer != "audio-waveform" && result.Renderer != "video-poster" && result.Renderer != "sandboxed-html" {
					return fmt.Errorf("preview processor returned invalid renderer")
				}
				renderer = result.Renderer
			}
			artifactMeta, err := json.Marshal(result.ArtifactMeta)
			if err != nil {
				return err
			}
			assetMeta, err := json.Marshal(result.AssetMetadata)
			if err != nil {
				return err
			}
			tx, err := w.DB.BeginTx(ctx, nil)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			updated, err := tx.ExecContext(ctx, `UPDATE preview_jobs SET status='succeeded',renderer=$3,lease_expires_at=NULL,error_code=NULL,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2`, job.ID, job.Attempts, renderer)
			if err != nil {
				return err
			}
			if affected, _ := updated.RowsAffected(); affected != 1 {
				return fmt.Errorf("job lease lost")
			}
			if _, err = tx.ExecContext(ctx, `UPDATE preview_artifacts SET renderer=$3,status='ready',artifact_ref=$4,metadata=$5::jsonb,generated_at=now(),error=NULL WHERE asset_id=$1 AND renderer=$2`, job.AssetID, job.Renderer, renderer, result.ArtifactRef, artifactMeta); err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE assets SET metadata=metadata || $2::jsonb,format=CASE WHEN $3 <> '' THEN $3 ELSE format END,kind=CASE WHEN $4 <> '' THEN $4 ELSE kind END,processing=jsonb_set(processing,'{state}','"ready"'::jsonb),updated_at=now() WHERE id=$1`, job.AssetID, assetMeta, result.Format, result.AssetKind); err != nil {
				return err
			}
			return tx.Commit()
		}
	}

	if !retryable || job.Attempts >= 4 {
		tx, err := w.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		updated, err := tx.ExecContext(ctx, `UPDATE preview_jobs SET status='failed',lease_expires_at=NULL,error_code=$3,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2`, job.ID, job.Attempts, "preview-failed")
		if err != nil {
			return err
		}
		if affected, _ := updated.RowsAffected(); affected != 1 {
			return fmt.Errorf("job lease lost")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE preview_artifacts SET status='failed',error=jsonb_build_object('code',$2::text,'retryable',false),generated_at=now() WHERE asset_id=$1 AND renderer=$3`, job.AssetID, "preview-failed", job.Renderer); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE assets SET processing=jsonb_set(processing,'{state}','"failed"'::jsonb),updated_at=now() WHERE id=$1`, job.AssetID); err != nil {
			return err
		}
		return tx.Commit()
	}
	delays := []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute}
	updated, err := w.DB.ExecContext(ctx, `UPDATE preview_jobs SET status='retry_wait',next_attempt_at=$3,lease_expires_at=NULL,error_code=$4,updated_at=now() WHERE id=$1 AND status='running' AND attempts=$2`, job.ID, job.Attempts, w.now().Add(delays[job.Attempts-1]), "preview-failed")
	if err != nil {
		return err
	}
	if affected, _ := updated.RowsAffected(); affected != 1 {
		return fmt.Errorf("job lease lost")
	}
	return nil
}

// RunOnce executes one leased job, renews it every minute, and enforces the
// five-minute total deadline. A lost lease cancels the processor immediately.
func (w *Worker) RunOnce(ctx context.Context) (bool, error) {
	job, err := w.Claim(ctx)
	if err != nil || job == nil {
		return false, err
	}
	if w.Process == nil {
		err = NewProcessError(fmt.Errorf("preview processor is not configured"), false)
		return true, w.Finish(ctx, *job, Result{}, err, false)
	}

	jobCtx, cancel := context.WithTimeout(ctx, w.jobTimeout())
	renewDone := renewUntil(jobCtx, w.renewInterval(), func() error { return w.Renew(jobCtx, *job) }, cancel)
	result, processErr := w.Process(jobCtx, *job)
	timedOut := errors.Is(jobCtx.Err(), context.DeadlineExceeded)
	cancel()
	renewErr := <-renewDone
	if renewErr != nil {
		return true, renewErr
	}
	if timedOut {
		processErr = NewProcessError(context.DeadlineExceeded, true)
	}
	return true, w.Finish(ctx, *job, result, processErr, IsRetryable(processErr))
}

func renewUntil(ctx context.Context, interval time.Duration, renew func() error, cancel context.CancelFunc) <-chan error {
	done := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				done <- nil
				return
			case <-ticker.C:
				if err := renew(); err != nil {
					done <- err
					cancel()
					return
				}
			}
		}
	}()
	return done
}
