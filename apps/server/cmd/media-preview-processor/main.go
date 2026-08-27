package main

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/preview"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	maxInputBytes = int64(1 << 30)
	jobTimeout    = 5 * time.Minute
	probeTimeout  = 30 * time.Second
	ffmpegTimeout = 4 * time.Minute
	ffprobePath   = "/usr/bin/ffprobe"
	ffmpegPath    = "/usr/bin/ffmpeg"
)

type processorError struct {
	code      string
	retryable bool
	cause     error
}

func (e *processorError) Error() string {
	if e.cause == nil {
		return e.code
	}
	return e.code + ": " + e.cause.Error()
}
func permanent(code string, cause error) error { return &processorError{code: code, cause: cause} }
func temporary(code string, cause error) error {
	return &processorError{code: code, retryable: true, cause: cause}
}

type arguments struct{ jobID, assetID, renderer string }

type assetJob struct {
	assetID, renderer, storageRef, kind, mimeType, displayName string
	byteSize                                                   int64
}

type probeOutput struct {
	Format struct {
		Duration string `json:"duration"`
		Name     string `json:"format_name"`
	} `json:"format"`
	Streams []struct {
		CodecType string `json:"codec_type"`
	} `json:"streams"`
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		var processErr *processorError
		if errors.As(err, &processErr) {
			fmt.Fprintln(os.Stderr, processErr.code)
			if processErr.retryable {
				os.Exit(75)
			}
		} else {
			fmt.Fprintln(os.Stderr, "PROCESSOR_FAILED")
		}
		os.Exit(1)
	}
}

func run(ctx context.Context, rawArgs []string, output io.Writer) error {
	args, err := parseArguments(rawArgs)
	if err != nil {
		return err
	}
	db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		return temporary("DATABASE_TEMPORARY", err)
	}
	defer db.Close()

	job, err := loadAssetJob(ctx, db, args)
	if err != nil {
		return err
	}
	if err := validatePair(job.renderer, job.kind, job.mimeType); err != nil {
		return err
	}
	if job.byteSize < 0 || job.byteSize > maxInputBytes {
		return permanent("MEDIA_TOO_LARGE", nil)
	}

	store, err := assets.S3FromEnvironment()
	if err != nil {
		return permanent("STORAGE_CONFIGURATION", err)
	}
	actualMIME, actualSize, err := store.StatContext(ctx, job.storageRef)
	if err != nil {
		return temporary("STORAGE_TEMPORARY", err)
	}
	if actualSize < 0 || actualSize > maxInputBytes {
		return permanent("MEDIA_TOO_LARGE", nil)
	}
	if err := validatePair(job.renderer, job.kind, actualMIME); err != nil {
		return err
	}

	dir, err := os.MkdirTemp("", "dw-media-")
	if err != nil {
		return temporary("TEMPORARY_STORAGE", err)
	}
	defer os.RemoveAll(dir)
	source := filepath.Join(dir, args.assetID+".media")
	file, err := os.OpenFile(source, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return temporary("TEMPORARY_STORAGE", err)
	}
	downloadErr := store.DownloadTo(ctx, job.storageRef, file, maxInputBytes)
	closeErr := file.Close()
	if downloadErr != nil {
		if errors.Is(downloadErr, assets.ErrObjectTooLarge) {
			return permanent("MEDIA_TOO_LARGE", nil)
		}
		return temporary("STORAGE_TEMPORARY", downloadErr)
	}
	if closeErr != nil {
		return temporary("TEMPORARY_STORAGE", closeErr)
	}

	if job.renderer == "sandboxed-html" {
		if actualSize > 64<<20 {
			return permanent("HTML_TOO_LARGE", nil)
		}
		html, err := os.ReadFile(source)
		if err != nil {
			return temporary("TEMPORARY_STORAGE", err)
		}
		artifact, err := preview.BuildSandboxedHTML(job.displayName, html)
		if err != nil {
			return permanent("HTML_INVALID", err)
		}
		outRef := "derivatives/" + args.assetID + "/sandboxed-html.html"
		if err = store.WriteContext(ctx, outRef, "text/html; charset=utf-8", artifact); err != nil {
			return temporary("STORAGE_TEMPORARY", err)
		}
		result := preview.Result{ArtifactRef: outRef, ArtifactMeta: map[string]any{"entry": "sandboxed-html.html"}, AssetMetadata: map[string]any{}, Format: "html"}
		if err := json.NewEncoder(output).Encode(result); err != nil {
			return temporary("PROCESSOR_OUTPUT", err)
		}
		return nil
	}

	probe, err := probeMedia(ctx, source)
	if err != nil {
		return err
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(probe.Format.Duration), 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 {
		return permanent("MEDIA_INVALID", err)
	}
	renderer := rendererForProbe(probe)
	if renderer == "" {
		return permanent("MEDIA_STREAM_MISSING", nil)
	}

	result := preview.Result{AssetMetadata: map[string]any{"durationMs": int64(math.Round(duration * 1000))}, Format: probe.Format.Name, Renderer: renderer, AssetKind: assetKindForRenderer(renderer)}
	switch renderer {
	case "audio-waveform":
		pcm, err := runCommand(ctx, ffmpegTimeout, toolPath("DW_FFMPEG_PATH", ffmpegPath), "-v", "error", "-i", source, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "s16le", "-")
		if err != nil {
			return err
		}
		waveform := peaks(pcm)
		payload, err := json.Marshal(map[string]any{"waveform": waveform})
		if err != nil {
			return permanent("PROCESSOR_RESULT_INVALID", err)
		}
		outRef := "derivatives/" + args.assetID + "/audio-waveform.json"
		if err = store.WriteContext(ctx, outRef, "application/json", payload); err != nil {
			return temporary("STORAGE_TEMPORARY", err)
		}
		result.ArtifactRef = outRef
		result.ArtifactMeta = map[string]any{"waveform": waveform}
		result.AssetMetadata["waveform"] = waveform
		result.AssetMetadata["sceneLabel"] = ""
	case "video-poster":
		poster := filepath.Join(dir, args.assetID+".jpg")
		seek := strconv.FormatFloat(math.Min(1, duration/2), 'f', 3, 64)
		if _, err = runCommand(ctx, ffmpegTimeout, toolPath("DW_FFMPEG_PATH", ffmpegPath), "-v", "error", "-ss", seek, "-i", source, "-map", "0:v:0", "-frames:v", "1", "-q:v", "3", poster); err != nil {
			return err
		}
		image, err := os.ReadFile(poster)
		if err != nil {
			return permanent("MEDIA_INVALID", err)
		}
		outRef := "derivatives/" + args.assetID + "/video-poster.jpg"
		if err = store.WriteContext(ctx, outRef, "image/jpeg", image); err != nil {
			return temporary("STORAGE_TEMPORARY", err)
		}
		result.ArtifactRef = outRef
		result.ArtifactMeta = map[string]any{}
		result.AssetMetadata["shotLabel"] = ""
	default:
		return permanent("RENDERER_UNSUPPORTED", nil)
	}
	if err := json.NewEncoder(output).Encode(result); err != nil {
		return temporary("PROCESSOR_OUTPUT", err)
	}
	return nil
}

func parseArguments(values []string) (arguments, error) {
	var result arguments
	if len(values) != 6 {
		return result, permanent("INVALID_JOB_ARGUMENTS", nil)
	}
	for i := 0; i < len(values); i += 2 {
		if i+1 >= len(values) || values[i+1] == "" {
			return result, permanent("INVALID_JOB_ARGUMENTS", nil)
		}
		switch values[i] {
		case "--job-id":
			result.jobID = values[i+1]
		case "--asset-id":
			result.assetID = values[i+1]
		case "--renderer":
			result.renderer = values[i+1]
		default:
			return result, permanent("INVALID_JOB_ARGUMENTS", nil)
		}
	}
	if uuid.Validate(result.jobID) != nil || uuid.Validate(result.assetID) != nil {
		return result, permanent("INVALID_JOB_ARGUMENTS", nil)
	}
	if result.renderer != "audio-waveform" && result.renderer != "video-poster" && result.renderer != "sandboxed-html" {
		return result, permanent("RENDERER_UNSUPPORTED", nil)
	}
	return result, nil
}

func loadAssetJob(ctx context.Context, db *sql.DB, args arguments) (assetJob, error) {
	var result assetJob
	err := db.QueryRowContext(ctx, `SELECT j.asset_id,j.renderer,a.storage_ref,a.kind,a.mime_type,a.display_name,COALESCE(a.byte_size,-1) FROM preview_jobs j JOIN assets a ON a.id=j.asset_id WHERE j.id=$1`, args.jobID).
		Scan(&result.assetID, &result.renderer, &result.storageRef, &result.kind, &result.mimeType, &result.displayName, &result.byteSize)
	if err == sql.ErrNoRows {
		return result, permanent("JOB_NOT_FOUND", nil)
	}
	if err != nil {
		return result, temporary("DATABASE_TEMPORARY", err)
	}
	if result.assetID != args.assetID || result.renderer != args.renderer {
		return result, permanent("JOB_ARGUMENT_MISMATCH", nil)
	}
	return result, nil
}

func validatePair(renderer, kind, _ string) error {
	switch renderer {
	case "audio-waveform":
		if kind != "audio" {
			return permanent("RENDERER_MISMATCH", nil)
		}
	case "video-poster":
		if kind != "video" {
			return permanent("RENDERER_MISMATCH", nil)
		}
	case "sandboxed-html":
		if kind != "html" {
			return permanent("RENDERER_MISMATCH", nil)
		}
	default:
		return permanent("RENDERER_UNSUPPORTED", nil)
	}
	return nil
}

func probeMedia(ctx context.Context, source string) (probeOutput, error) {
	var result probeOutput
	out, err := runCommand(ctx, probeTimeout, toolPath("DW_FFPROBE_PATH", ffprobePath), "-v", "error", "-show_entries", "format=duration,format_name", "-show_entries", "stream=codec_type", "-of", "json", source)
	if err != nil {
		return result, err
	}
	if err := json.Unmarshal(out, &result); err != nil {
		return result, permanent("MEDIA_INVALID", err)
	}
	return result, nil
}

// Containers use the pinned Alpine paths. Local development resolves tools
// through PATH (for example Homebrew's /opt/homebrew/bin) unless overridden.
func toolPath(variable, fallback string) string {
	if configured := strings.TrimSpace(os.Getenv(variable)); configured != "" {
		return configured
	}
	if resolved, err := exec.LookPath(filepath.Base(fallback)); err == nil {
		return resolved
	}
	return fallback
}

func runCommand(parent context.Context, timeout time.Duration, binary string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, binary, args...).Output()
	if ctx.Err() != nil {
		return nil, temporary("PROCESSOR_TIMEOUT", ctx.Err())
	}
	if err != nil {
		return nil, permanent("MEDIA_INVALID", err)
	}
	return output, nil
}

func streamForRenderer(renderer string) string {
	if renderer == "audio-waveform" {
		return "audio"
	}
	return "video"
}
func rendererForProbe(probe probeOutput) string {
	// A file containing video is a video asset even when it also has an audio
	// stream. The worker's ffprobe result, never the client MIME header, decides.
	if hasStream(probe, "video") {
		return "video-poster"
	}
	if hasStream(probe, "audio") {
		return "audio-waveform"
	}
	return ""
}
func assetKindForRenderer(renderer string) string {
	if renderer == "video-poster" {
		return "video"
	}
	return "audio"
}
func hasStream(probe probeOutput, kind string) bool {
	for _, stream := range probe.Streams {
		if stream.CodecType == kind {
			return true
		}
	}
	return false
}
func peaks(pcm []byte) []float64 {
	out := make([]float64, 64)
	samples := len(pcm) / 2
	if samples == 0 {
		return out
	}
	for i := 0; i < samples; i++ {
		v := math.Abs(float64(int16(binary.LittleEndian.Uint16(pcm[i*2:])))) / 32768
		bucket := i * len(out) / samples
		if v > out[bucket] {
			out[bucket] = v
		}
	}
	return out
}
