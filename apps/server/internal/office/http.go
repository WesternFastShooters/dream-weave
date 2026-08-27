package office

import (
	"encoding/json"
	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"net"
	"net/http"
	"regexp"
	"strings"
)

var sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

// ViewerSessionHandler is served exclusively through the office origin. It
// accepts only a high-entropy, short-lived session identifier and never
// accepts project IDs, asset IDs, or browser credentials.
func (s *Service) ViewerSessionHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			apierror.Write(w, apierror.Forbidden())
			return
		}
		const prefix = "/internal/office-viewer-sessions/"
		if !strings.HasPrefix(r.URL.Path, prefix) {
			apierror.Write(w, apierror.Forbidden())
			return
		}
		sessionID := strings.TrimPrefix(r.URL.Path, prefix)
		if !sessionIDPattern.MatchString(sessionID) {
			apierror.Write(w, apierror.NotFound("OFFICE_SESSION_NOT_FOUND"))
			return
		}
		config, ok := s.ViewerSession(sessionID)
		if !ok {
			apierror.Write(w, apierror.NotFound("OFFICE_SESSION_NOT_FOUND"))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_ = json.NewEncoder(w).Encode(config)
	})
}

// SourceProxyHandler is bound only to the private office-internal listener.
// It intentionally exposes no application or browser routes.
func (s *Service) SourceProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			apierror.Write(w, apierror.Forbidden())
			return
		}
		const prefix = "/internal/office-source/"
		if !strings.HasPrefix(r.URL.Path, prefix) {
			apierror.Write(w, apierror.Forbidden())
			return
		}
		host, _, e := net.SplitHostPort(r.RemoteAddr)
		if e != nil {
			apierror.Write(w, apierror.Forbidden())
			return
		}
		asset, e := s.AuthorizeSource(strings.TrimPrefix(r.URL.Path, prefix), net.ParseIP(host))
		if e != nil {
			apierror.Write(w, e)
			return
		}
		var ref, mimeType string
		e = s.DB.QueryRowContext(r.Context(), `SELECT storage_ref,mime_type FROM assets WHERE id=$1`, asset).Scan(&ref, &mimeType)
		if e != nil {
			apierror.Write(w, apierror.NotFound("ASSET_NOT_FOUND"))
			return
		}
		if s.Store == nil {
			apierror.Write(w, apierror.New(http.StatusServiceUnavailable, "OFFICE_SESSION_UNAVAILABLE", "office source storage is unavailable", nil))
			return
		}
		contents, e := s.Store.Read(ref)
		if e != nil {
			apierror.Write(w, e)
			return
		}
		w.Header().Set("Content-Type", mimeType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(contents)
	})
}
