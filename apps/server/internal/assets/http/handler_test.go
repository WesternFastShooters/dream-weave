package http

import (
	"net/http"
	"strings"
	"testing"
)

func TestHTMLPreviewResponseHeadersEnforceOpaqueSandboxBoundary(t *testing.T) {
	header := make(http.Header)
	setPurposeResponseHeaders(header, "html-preview", "https://app.example.test")

	if got := header.Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	csp := header.Get("Content-Security-Policy")
	if strings.Contains(csp, "'unsafe-inline'") {
		t.Fatalf("HTML preview CSP must not allow unsafe inline content: %q", csp)
	}
	for _, directive := range []string{
		"default-src 'none'",
		"connect-src 'none'",
		"frame-src 'none'",
		"child-src 'none'",
		"object-src 'none'",
		"form-action 'none'",
		"frame-ancestors https://app.example.test",
	} {
		if !strings.Contains(csp, directive) {
			t.Fatalf("Content-Security-Policy %q does not contain %q", csp, directive)
		}
	}
	if got := header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
}

func TestPurposeResponseHeadersDoNotApplyHTMLPolicyToOtherPurposes(t *testing.T) {
	preview := make(http.Header)
	setPurposeResponseHeaders(preview, "preview", "https://app.example.test")
	if got := preview.Get("Content-Security-Policy"); got != "" {
		t.Fatalf("ordinary preview CSP = %q, want empty", got)
	}
	if got := preview.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("preview CORS origin = %q", got)
	}
	if got := preview.Get("Access-Control-Expose-Headers"); got != "" {
		t.Fatalf("preview CORS exposed headers = %q", got)
	}

	download := make(http.Header)
	setPurposeResponseHeaders(download, "download", "https://app.example.test")
	if got := download.Get("Content-Disposition"); got != "" {
		t.Fatalf("download Content-Disposition = %q", got)
	}
	if got := download.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("download CORS origin = %q", got)
	}
}
