package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/dream-weave/dream-weave/apps/server/internal/preview"
)

func TestCommandProcessorTreatsExit75AsRetryable(t *testing.T) {
	processor := commandProcessor(writeProcessor(t, "#!/bin/sh\nexit 75\n"))
	_, err := processor(context.Background(), preview.Job{ID: "job", AssetID: "asset", Renderer: "audio-waveform"})
	if !preview.IsRetryable(err) {
		t.Fatalf("error = %v, want retryable", err)
	}
}

func TestCommandProcessorTreatsOtherExitAsPermanent(t *testing.T) {
	processor := commandProcessor(writeProcessor(t, "#!/bin/sh\nexit 1\n"))
	_, err := processor(context.Background(), preview.Job{ID: "job", AssetID: "asset", Renderer: "audio-waveform"})
	if err == nil || preview.IsRetryable(err) {
		t.Fatalf("error = %v, want permanent", err)
	}
}

func TestCommandProcessorAcceptsResultJSON(t *testing.T) {
	processor := commandProcessor(writeProcessor(t, "#!/bin/sh\nprintf '%s' '{\"ArtifactRef\":\"artifact\"}'\n"))
	result, err := processor(context.Background(), preview.Job{ID: "job", AssetID: "asset", Renderer: "audio-waveform"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ArtifactRef != "artifact" {
		t.Fatalf("ArtifactRef = %q", result.ArtifactRef)
	}
}

func writeProcessor(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "processor")
	if err := os.WriteFile(path, []byte(contents), 0700); err != nil {
		t.Fatal(err)
	}
	return path
}
