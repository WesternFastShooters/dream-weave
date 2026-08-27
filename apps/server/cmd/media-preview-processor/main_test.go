package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseArgumentsRejectsUnknownRenderer(t *testing.T) {
	_, err := parseArguments([]string{"--job-id", uuid.NewString(), "--asset-id", uuid.NewString(), "--renderer", "unexpected"})
	assertProcessorError(t, err, "RENDERER_UNSUPPORTED", false)
}

func TestValidatePairIsExact(t *testing.T) {
	cases := []struct{ renderer, kind, mime string }{
		{"audio-waveform", "video", "video/mp4"},
		{"video-poster", "audio", "audio/mpeg"},
		{"unknown", "video", "video/mp4"},
	}
	for _, tc := range cases {
		if err := validatePair(tc.renderer, tc.kind, tc.mime); err == nil {
			t.Fatalf("validatePair(%q, %q, %q) succeeded", tc.renderer, tc.kind, tc.mime)
		}
	}
	if err := validatePair("audio-waveform", "audio", "audio/wav"); err != nil {
		t.Fatal(err)
	}
	if err := validatePair("video-poster", "video", "video/mp4"); err != nil {
		t.Fatal(err)
	}
	if err := validatePair("video-poster", "video", "audio/mpeg"); err != nil {
		t.Fatalf("upload MIME must not classify media: %v", err)
	}
}

func TestRendererForProbeClassifiesFromStreams(t *testing.T) {
	if got := rendererForProbe(probeOutput{Streams: []struct {
		CodecType string `json:"codec_type"`
	}{{CodecType: "audio"}}}); got != "audio-waveform" {
		t.Fatalf("audio stream renderer = %q", got)
	}
	if got := rendererForProbe(probeOutput{Streams: []struct {
		CodecType string `json:"codec_type"`
	}{{CodecType: "audio"}, {CodecType: "video"}}}); got != "video-poster" {
		t.Fatalf("video stream renderer = %q", got)
	}
}

func TestPeaksAlwaysReturnsBounded64PointWaveform(t *testing.T) {
	pcm := []byte{0xff, 0x7f, 0x00, 0x80, 0x00, 0x00}
	waveform := peaks(pcm)
	if len(waveform) != 64 {
		t.Fatalf("len(peaks) = %d", len(waveform))
	}
	for index, value := range waveform {
		if value < 0 || value > 1 {
			t.Fatalf("waveform[%d] = %f", index, value)
		}
	}
	if empty := peaks(nil); len(empty) != 64 {
		t.Fatalf("len(empty peaks) = %d", len(empty))
	}
}

func TestRunCommandClassifiesTimeoutAsRetryable(t *testing.T) {
	_, err := runCommand(context.Background(), 10*time.Millisecond, "/bin/sh", "-c", "sleep 1")
	assertProcessorError(t, err, "PROCESSOR_TIMEOUT", true)
}

func TestRunCommandClassifiesMediaFailureAsPermanent(t *testing.T) {
	_, err := runCommand(context.Background(), time.Second, "/bin/sh", "-c", "exit 1")
	assertProcessorError(t, err, "MEDIA_INVALID", false)
}

func assertProcessorError(t *testing.T, err error, code string, retryable bool) {
	t.Helper()
	var processErr *processorError
	if !errors.As(err, &processErr) {
		t.Fatalf("error = %v, want processorError", err)
	}
	if processErr.code != code || processErr.retryable != retryable {
		t.Fatalf("processorError = (%q, %v), want (%q, %v)", processErr.code, processErr.retryable, code, retryable)
	}
}
