// Package office creates narrowly scoped ONLYOFFICE viewer sessions and guards the private source proxy.
package office

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	assetsdomain "github.com/dream-weave/dream-weave/apps/server/internal/assets/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/resourceaccess"
	"net"
	"strings"
	"sync"
	"time"
)

type RuntimeConfig struct {
	SessionID         string `json:"sessionId"`
	DocumentServerURL string `json:"documentServerUrl"`
	DocumentURL       string `json:"documentUrl"`
	DocumentKey       string `json:"documentKey"`
	Token             string `json:"token"`
	DocumentTitle     string `json:"documentTitle"`
	FileType          string `json:"fileType"`
	DocumentType      string `json:"documentType"`
	ExpiresAt         string `json:"expiresAt"`
}
type Service struct {
	DB                  *sql.DB
	Store               assetsdomain.ObjectStore
	Auth                service.Authorizer
	Capabilities        resourceaccess.Signer
	DocumentServerURL   string
	SourceProxyBase     string
	DocumentServerCIDRs []*net.IPNet
	OnlyOfficeJWTSecret []byte
	Now                 func() time.Time
	sessionsMu          sync.Mutex
	sessions            map[string]RuntimeConfig
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}
func (s *Service) Create(ctx context.Context, projectID, assetID string) (RuntimeConfig, error) {
	if e := s.Auth.Require(ctx, projectID, "project:read"); e != nil {
		return RuntimeConfig{}, e
	}
	var format, title, kind, ref, state string
	e := s.DB.QueryRowContext(ctx, `SELECT format,display_name,kind,storage_ref,processing->>'state' FROM assets WHERE id=$1 AND project_id=$2`, assetID, projectID).Scan(&format, &title, &kind, &ref, &state)
	if e == sql.ErrNoRows {
		return RuntimeConfig{}, apierror.NotFound("ASSET_NOT_FOUND")
	}
	if e != nil {
		return RuntimeConfig{}, e
	}
	typ, ok := viewerType(format)
	if (kind != "office" && kind != "pdf") || !ok {
		return RuntimeConfig{}, apierror.Validation("asset is not a supported document", map[string]string{"assetId": "wrong kind"})
	}
	if state != "ready" {
		return RuntimeConfig{}, apierror.New(409, "ASSET_NOT_READY", "asset processing is not complete", map[string]any{"assetId": assetID, "state": state})
	}
	expires := s.now().Add(5 * time.Minute)
	id := newID()
	cap, e := s.Capabilities.Issue(resourceaccess.Claims{AssetID: assetID, Purpose: "office-source", Audience: "document-server", ExpiresAt: expires.Unix()})
	if e != nil {
		return RuntimeConfig{}, e
	}
	documentURL := strings.TrimRight(s.SourceProxyBase, "/") + "/office-source/" + cap
	token, e := issueOnlyOfficeJWT(s.OnlyOfficeJWTSecret, documentURL, assetID, title, format, typ, expires)
	if e != nil {
		return RuntimeConfig{}, e
	}
	config := RuntimeConfig{id, s.DocumentServerURL, documentURL, assetID, token, title, format, typ, expires.Format(time.RFC3339)}
	s.sessionsMu.Lock()
	if s.sessions == nil {
		s.sessions = make(map[string]RuntimeConfig)
	}
	for sessionID, active := range s.sessions {
		if parsed, parseErr := time.Parse(time.RFC3339, active.ExpiresAt); parseErr != nil || !parsed.After(s.now()) {
			delete(s.sessions, sessionID)
		}
	}
	s.sessions[config.SessionID] = config
	s.sessionsMu.Unlock()
	return config, nil
}

// ViewerSession returns the short-lived, opaque session configuration used by
// the same-origin viewer shell. The unguessable session ID is created only
// after project-read authorization and expires with the ONLYOFFICE token.
func (s *Service) ViewerSession(sessionID string) (RuntimeConfig, bool) {
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	config, ok := s.sessions[sessionID]
	if !ok {
		return RuntimeConfig{}, false
	}
	expires, err := time.Parse(time.RFC3339, config.ExpiresAt)
	if err != nil || !expires.After(s.now()) {
		delete(s.sessions, sessionID)
		return RuntimeConfig{}, false
	}
	return config, true
}
func (s *Service) AuthorizeSource(token string, remote net.IP) (string, error) {
	allowed := false
	for _, cidr := range s.DocumentServerCIDRs {
		if cidr.Contains(remote) {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", apierror.Forbidden()
	}
	c, e := s.Capabilities.Verify(token, "office-source", "document-server", s.now())
	if e != nil {
		return "", apierror.Forbidden()
	}
	return c.AssetID, nil
}
func viewerType(format string) (string, bool) {
	switch strings.ToLower(format) {
	case "doc", "docx":
		return "word", true
	case "xls", "xlsx":
		return "cell", true
	case "ppt", "pptx":
		return "slide", true
	case "pdf":
		return "pdf", true
	}
	return "", false
}
func newID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("secure Office session id: " + err.Error())
	}
	return "office-" + hex.EncodeToString(bytes)
}

// issueOnlyOfficeJWT signs the exact read-only editor configuration consumed by
// DocsAPI. It is deliberately separate from Dream Weave's source capability:
// Document Server validates this token with ONLYOFFICE_JWT_SECRET, while the
// private source proxy validates its own audience-bound capability.
func issueOnlyOfficeJWT(secret []byte, documentURL, key, title, fileType, documentType string, expires time.Time) (string, error) {
	if len(secret) < 32 {
		return "", fmt.Errorf("ONLYOFFICE_JWT_SECRET must contain at least 32 bytes")
	}
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]any{
		"type": "embedded",
		"document": map[string]any{
			"fileType": fileType, "key": key, "title": title, "url": documentURL,
			"permissions": map[string]bool{"edit": false, "download": false, "print": false, "comment": false, "copy": false},
		},
		"documentType": documentType,
		"editorConfig": map[string]any{
			"mode":      "view",
			"coEditing": map[string]any{"mode": "strict", "change": false},
			"embedded":  map[string]string{"autostart": "document", "toolbarDocked": "bottom"},
			"customization": map[string]bool{
				"compactHeader": true, "compactToolbar": true, "hideRulers": true, "hideRightMenu": true, "showHorizontalScroll": false, "showVerticalScroll": false, "toolbarNoTabs": true,
			},
		},
		"exp": expires.Unix(),
	})
	if err != nil {
		return "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	signingInput := encode(header) + "." + encode(payload)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(signingInput))
	return signingInput + "." + encode(mac.Sum(nil)), nil
}
