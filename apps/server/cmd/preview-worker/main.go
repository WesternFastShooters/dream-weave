package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dream-weave/dream-weave/apps/server/internal/preview"
	_ "github.com/jackc/pgx/v5/stdlib"
	"log"
	"os"
	"os/exec"
	"time"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required; install/configure PostgreSQL and register its database/sql driver")
	}
	processor := os.Getenv("DW_PREVIEW_PROCESSOR")
	if processor == "" {
		log.Fatal("DW_PREVIEW_PROCESSOR must name the real isolated preview processor; this worker never fabricates preview output")
	}
	db, e := sql.Open("pgx", dsn)
	if e != nil {
		log.Fatal(e)
	}
	defer db.Close()
	w := &preview.Worker{DB: db, Process: commandProcessor(processor)}
	for {
		worked, e := w.RunOnce(context.Background())
		if e != nil {
			log.Printf("preview job: %v", e)
		}
		if !worked {
			time.Sleep(time.Second)
		}
	}
}
func commandProcessor(binary string) func(context.Context, preview.Job) (preview.Result, error) {
	return func(ctx context.Context, j preview.Job) (preview.Result, error) {
		cmd := exec.CommandContext(ctx, binary, "--job-id", j.ID, "--asset-id", j.AssetID, "--renderer", j.Renderer)
		// The isolated processor receives only the worker process environment; it is
		// never exposed to browsers and must use its configured storage credentials
		// to write the returned artifact reference.
		output, err := cmd.CombinedOutput()
		if err != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return preview.Result{}, preview.NewProcessError(fmt.Errorf("preview processor timed out"), true)
			}
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				// Exit 75 is the processor contract for temporary storage/database
				// failures and command timeouts. All other exits are permanent.
				return preview.Result{}, preview.NewProcessError(fmt.Errorf("preview processor exited with code %d", exitErr.ExitCode()), exitErr.ExitCode() == 75)
			}
			return preview.Result{}, preview.NewProcessError(fmt.Errorf("preview processor could not start: %w", err), false)
		}
		var result preview.Result
		if err := json.Unmarshal(output, &result); err != nil {
			return preview.Result{}, preview.NewProcessError(fmt.Errorf("preview processor returned invalid JSON: %w", err), false)
		}
		if result.ArtifactRef == "" {
			return preview.Result{}, preview.NewProcessError(fmt.Errorf("preview processor returned no artifact reference"), false)
		}
		return result, nil
	}
}
