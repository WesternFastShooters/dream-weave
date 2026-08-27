package office

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIssueOnlyOfficeJWTSignsReadonlyConfiguration(t *testing.T) {
	expires := time.Date(2026, 7, 22, 1, 2, 3, 0, time.UTC)
	token, err := issueOnlyOfficeJWT([]byte("01234567890123456789012345678901"), "http://server:8081/internal/office-source/capability", "asset-key", "read-only.docx", "docx", "word", expires)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected compact JWT, got %q", token)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Type     string `json:"type"`
		Document struct {
			URL         string          `json:"url"`
			Permissions map[string]bool `json:"permissions"`
		} `json:"document"`
		EditorConfig struct {
			Mode      string `json:"mode"`
			CoEditing struct {
				Mode   string `json:"mode"`
				Change bool   `json:"change"`
			} `json:"coEditing"`
			Embedded struct {
				Autostart     string `json:"autostart"`
				ToolbarDocked string `json:"toolbarDocked"`
			} `json:"embedded"`
			Customization map[string]bool `json:"customization"`
		} `json:"editorConfig"`
		ExpiresAt int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Type != "embedded" || decoded.Document.URL != "http://server:8081/internal/office-source/capability" || decoded.EditorConfig.Mode != "view" || decoded.EditorConfig.CoEditing.Mode != "strict" || decoded.EditorConfig.CoEditing.Change || decoded.EditorConfig.Embedded.Autostart != "document" || decoded.EditorConfig.Embedded.ToolbarDocked != "bottom" || decoded.ExpiresAt != expires.Unix() {
		t.Fatalf("unexpected viewer claims: %+v", decoded)
	}
	for _, option := range []string{"compactHeader", "compactToolbar", "hideRulers", "hideRightMenu", "toolbarNoTabs"} {
		if !decoded.EditorConfig.Customization[option] {
			t.Fatalf("%s must be enabled for embedded preview", option)
		}
	}
	for _, option := range []string{"showHorizontalScroll", "showVerticalScroll"} {
		if decoded.EditorConfig.Customization[option] {
			t.Fatalf("%s must be disabled for embedded preview", option)
		}
	}
	for _, permission := range []string{"edit", "download", "print", "comment", "copy"} {
		if decoded.Document.Permissions[permission] {
			t.Fatalf("%s must remain disabled", permission)
		}
	}
}

func TestViewerSessionHandlerReturnsOnlyActiveOpaqueSession(t *testing.T) {
	now := time.Date(2026, 7, 24, 5, 0, 0, 0, time.UTC)
	active := RuntimeConfig{SessionID: "office-0123456789abcdef0123456789abcdef", DocumentTitle: "active.docx", ExpiresAt: now.Add(time.Minute).Format(time.RFC3339)}
	svc := &Service{Now: func() time.Time { return now }, sessions: map[string]RuntimeConfig{active.SessionID: active}}
	request := httptest.NewRequest(http.MethodGet, "/internal/office-viewer-sessions/"+active.SessionID, nil)
	recorder := httptest.NewRecorder()
	svc.ViewerSessionHandler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("viewer session response = %d, headers=%v", recorder.Code, recorder.Header())
	}
	var received RuntimeConfig
	if err := json.NewDecoder(recorder.Body).Decode(&received); err != nil || received != active {
		t.Fatalf("viewer session body = %+v, err=%v; want %+v", received, err, active)
	}

	missing := httptest.NewRecorder()
	svc.ViewerSessionHandler().ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/internal/office-viewer-sessions/office-ffffffffffffffffffffffffffffffff", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing viewer session status = %d; want %d", missing.Code, http.StatusNotFound)
	}
}

func TestIssueOnlyOfficeJWTRejectsShortSecret(t *testing.T) {
	if _, err := issueOnlyOfficeJWT([]byte("short"), "https://source.example.test/file", "key", "title", "docx", "word", time.Now().Add(time.Minute)); err == nil {
		t.Fatal("short ONLYOFFICE_JWT_SECRET was accepted")
	}
}

func TestViewerTypeSupportsOfficeAndPDF(t *testing.T) {
	for format, expected := range map[string]string{"docx": "word", "xlsx": "cell", "pptx": "slide", "pdf": "pdf"} {
		actual, ok := viewerType(format)
		if !ok || actual != expected {
			t.Fatalf("viewerType(%q) = %q, %t; want %q, true", format, actual, ok, expected)
		}
	}
	if _, ok := viewerType("zip"); ok {
		t.Fatal("viewerType accepted an unsupported format")
	}
}
