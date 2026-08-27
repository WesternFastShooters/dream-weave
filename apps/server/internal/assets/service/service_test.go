package service

import (
	"testing"

	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
	"github.com/google/uuid"
)

func TestNewIDReturnsUniqueRFC4122Version4UUIDs(t *testing.T) {
	seen := make(map[string]struct{}, 1000)
	for index := 0; index < 1000; index++ {
		id := newID()
		if !mutation.IsUUID(id) {
			t.Fatalf("newID() = %q, want a canvas-compatible UUID", id)
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			t.Fatalf("uuid.Parse(%q): %v", id, err)
		}
		if parsed.Version() != 4 {
			t.Fatalf("UUID version = %d, want 4", parsed.Version())
		}
		if parsed.Variant() != uuid.RFC4122 {
			t.Fatalf("UUID variant = %v, want RFC4122", parsed.Variant())
		}
		if _, exists := seen[id]; exists {
			t.Fatalf("newID() returned duplicate %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestDetectHTMLByExtensionAndContent(t *testing.T) {
	for _, fileName := range []string{"interactive.html", "interactive.htm"} {
		kind, format, err := detect(fileName, "application/octet-stream", []byte("<!doctype html><html><body>ok</body></html>"))
		if err != nil {
			t.Fatalf("detect(%q): %v", fileName, err)
		}
		if kind != "html" || format != "html" {
			t.Fatalf("detect(%q) = (%q, %q), want (html, html)", fileName, kind, format)
		}
	}
}

func TestDetectRejectsUnsupportedFormats(t *testing.T) {
	if _, _, err := detect("archive.bin", "application/octet-stream", []byte("not a supported canvas asset")); err == nil {
		t.Fatal("detect accepted an unsupported format")
	}
}
