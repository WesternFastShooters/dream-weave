package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	ad "github.com/dream-weave/dream-weave/apps/server/internal/assets/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/resourceaccess"
	"github.com/google/uuid"
)

type Service struct {
	DB             *sql.DB
	Store          ad.ObjectStore
	Auth           service.Authorizer
	Capabilities   resourceaccess.Signer
	Now            func() time.Time
	MaxUploadBytes int64
	// PreviewOrigin is a cookie/API-free origin which serves only controlled
	// preview artifacts. It must not be the authenticated application origin.
	PreviewOrigin        string
	PreviewFrameAncestor string
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}
func (s *Service) CreateUpload(ctx context.Context, p, name, declared string, size int64) (ad.UploadTicket, error) {
	if e := s.Auth.Require(ctx, p, "project:write"); e != nil {
		return ad.UploadTicket{}, e
	}
	if textExtension(name) {
		return ad.UploadTicket{}, apierror.Validation("text files must create markdown nodes directly", map[string]string{"fileName": "text upload forbidden"})
	}
	if size < 0 || s.MaxUploadBytes > 0 && size > s.MaxUploadBytes {
		return ad.UploadTicket{}, apierror.Validation("file size is invalid", map[string]string{"byteSize": "invalid"})
	}
	id, ref := newID(), "uploads/"+newID()
	expires := s.now().Add(15 * time.Minute)
	url, h, e := s.Store.CreateUpload(ref, declared, size, expires)
	if e != nil {
		return ad.UploadTicket{}, e
	}
	_, e = s.DB.ExecContext(ctx, `INSERT INTO asset_uploads(id,project_id,storage_ref,file_name,declared_mime_type,declared_byte_size,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, p, ref, filepath.Base(name), declared, size, expires)
	if e != nil {
		return ad.UploadTicket{}, e
	}
	return ad.UploadTicket{UploadID: id, UploadURL: url, Method: "PUT", RequiredHeaders: h, ExpiresAt: expires.Format(time.RFC3339)}, nil
}
func (s *Service) Complete(ctx context.Context, p, uploadID string) (ad.Asset, error) {
	if e := s.Auth.Require(ctx, p, "project:write"); e != nil {
		return ad.Asset{}, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ad.Asset{}, e
	}
	defer tx.Rollback()
	var u ad.UploadRecord
	e = tx.QueryRowContext(ctx, `SELECT id,project_id,storage_ref,file_name,declared_mime_type,declared_byte_size,expires_at,completed_at FROM asset_uploads WHERE id=$1 AND project_id=$2 FOR UPDATE`, uploadID, p).Scan(&u.ID, &u.ProjectID, &u.StorageRef, &u.FileName, &u.DeclaredMIME, &u.DeclaredBytes, &u.ExpiresAt, &u.CompletedAt)
	if e == sql.ErrNoRows {
		return ad.Asset{}, apierror.NotFound("ASSET_NOT_FOUND")
	}
	if e != nil {
		return ad.Asset{}, e
	}
	if u.CompletedAt != nil {
		return ad.Asset{}, apierror.Validation("upload already completed", map[string]string{"uploadId": "already completed"})
	}
	if s.now().After(u.ExpiresAt) {
		return ad.Asset{}, apierror.Validation("upload ticket expired", map[string]string{"uploadId": "expired"})
	}
	actualMime, size, e := s.Store.Stat(u.StorageRef)
	if e != nil {
		return ad.Asset{}, e
	}
	if size != u.DeclaredBytes {
		return ad.Asset{}, apierror.Validation("uploaded byte size differs", map[string]string{"byteSize": "mismatch"})
	}
	raw, e := s.Store.ReadPrefix(u.StorageRef, 4096)
	if e != nil {
		return ad.Asset{}, e
	}
	kind, format, e := detect(u.FileName, actualMime, raw)
	if e != nil {
		return ad.Asset{}, apierror.Validation(e.Error(), map[string]string{"fileName": "unsupported-format"})
	}
	meta, _ := json.Marshal(map[string]any{})
	renderer := rendererFor(kind, format)
	processingState := "ready"
	if renderer != "" {
		processingState = "queued"
	}
	processing, _ := json.Marshal(map[string]any{"state": processingState})
	id := newID()
	_, e = tx.ExecContext(ctx, `INSERT INTO assets(id,project_id,kind,display_name,source_type,storage_ref,mime_type,format,byte_size,metadata,processing) VALUES($1,$2,$3,$4,'managed-object',$5,$6,$7,$8,$9::jsonb,$10::jsonb)`, id, p, kind, filepath.Base(u.FileName), u.StorageRef, actualMime, format, size, meta, processing)
	if e != nil {
		return ad.Asset{}, e
	}
	if renderer != "" {
		if _, e = tx.ExecContext(ctx, `INSERT INTO preview_artifacts(asset_id,renderer,status,metadata) VALUES($1,$2,'queued','{}'::jsonb)`, id, renderer); e != nil {
			return ad.Asset{}, e
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO preview_jobs(id,asset_id,renderer,status) VALUES($1,$2,$3,'queued')`, newID(), id, renderer); e != nil {
			return ad.Asset{}, e
		}
	}
	_, e = tx.ExecContext(ctx, `UPDATE asset_uploads SET completed_at=now() WHERE id=$1`, u.ID)
	if e != nil {
		return ad.Asset{}, e
	}
	if e = tx.Commit(); e != nil {
		return ad.Asset{}, e
	}
	return ad.Asset{ID: id, ProjectID: p, Kind: string(kind), DisplayName: u.FileName, ProcessingState: processingState}, nil
}
func (s *Service) Access(ctx context.Context, p, assetID, purpose string) (ad.Access, error) {
	if purpose != "preview" && purpose != "download" && purpose != "playback" && purpose != "html-preview" {
		return ad.Access{}, apierror.Validation("unknown asset access purpose", map[string]string{"purpose": "invalid"})
	}
	if e := s.Auth.Require(ctx, p, "asset:download"); e != nil {
		return ad.Access{}, e
	}
	var storageRef sql.NullString
	var name, kind string
	var raw, metadataRaw []byte
	e := s.DB.QueryRowContext(ctx, `SELECT storage_ref,display_name,kind,processing,metadata FROM assets WHERE id=$1 AND project_id=$2`, assetID, p).Scan(&storageRef, &name, &kind, &raw, &metadataRaw)
	if e == sql.ErrNoRows {
		return ad.Access{}, apierror.NotFound("ASSET_NOT_FOUND")
	}
	if e != nil {
		return ad.Access{}, e
	}
	var state, metadata map[string]any
	_ = json.Unmarshal(raw, &state)
	_ = json.Unmarshal(metadataRaw, &metadata)
	if state["state"] != "ready" {
		return ad.Access{}, apierror.New(409, "ASSET_NOT_READY", "asset is not ready", map[string]any{"assetId": assetID, "state": state["state"]})
	}
	if purpose == "playback" && kind != "audio" && kind != "video" {
		return ad.Access{}, apierror.Validation("media playback requires an audio or video asset", map[string]string{"assetId": "wrong kind"})
	}
	if purpose == "html-preview" && kind != "html" {
		return ad.Access{}, apierror.Validation("HTML preview requires an HTML asset", map[string]string{"assetId": "wrong kind"})
	}
	expires := s.now().Add(5 * time.Minute)
	// Validate the purpose-specific original object or generated artifact before minting a browser capability.
	if _, err := s.accessRef(ctx, assetID, kind, storageRef.String, purpose); err != nil {
		return ad.Access{}, err
	}
	token, err := s.Capabilities.Issue(resourceaccess.Claims{AssetID: assetID, Purpose: purpose, Audience: "browser", ExpiresAt: expires.Unix()})
	if err != nil {
		return ad.Access{}, err
	}
	base := s.PreviewOrigin
	if base == "" {
		return ad.Access{}, fmt.Errorf("preview origin is not configured")
	}
	out := ad.Access{URL: strings.TrimRight(base, "/") + "/internal/asset-access/" + purpose + "/" + token, ExpiresAt: expires.Format(time.RFC3339)}
	if purpose == "download" {
		out.FileName = name
	}
	return out, nil
}

// Delivery resolves a one-purpose browser capability on the server, then creates
// a short-lived storage redirect. Preview artifacts and original downloads never
// share a storage reference.
type Delivery struct {
	URL      string
	FileName string
	ByteSize int64
}

func (s *Service) Delivery(ctx context.Context, purpose, capability string) (Delivery, error) {
	if purpose != "preview" && purpose != "download" && purpose != "playback" && purpose != "html-preview" {
		return Delivery{}, apierror.Forbidden()
	}
	claims, err := s.Capabilities.Verify(capability, purpose, "browser", s.now())
	if err != nil {
		return Delivery{}, apierror.Forbidden()
	}
	var ref sql.NullString
	var kind, displayName string
	var byteSize sql.NullInt64
	var metadataRaw []byte
	if err = s.DB.QueryRowContext(ctx, `SELECT storage_ref,kind,display_name,byte_size,metadata FROM assets WHERE id=$1`, claims.AssetID).Scan(&ref, &kind, &displayName, &byteSize, &metadataRaw); err == sql.ErrNoRows {
		return Delivery{}, apierror.NotFound("ASSET_NOT_FOUND")
	} else if err != nil {
		return Delivery{}, err
	}
	var metadata map[string]any
	_ = json.Unmarshal(metadataRaw, &metadata)
	resolved, err := s.accessRef(ctx, claims.AssetID, kind, ref.String, purpose)
	if err != nil {
		return Delivery{}, err
	}
	url, err := s.Store.SignedURL(resolved, "internal-delivery", s.now().Add(5*time.Minute))
	if err != nil {
		return Delivery{}, err
	}
	return Delivery{URL: url, FileName: displayName, ByteSize: byteSize.Int64}, nil
}
func (s *Service) accessRef(ctx context.Context, assetID, kind, originalRef, purpose string) (string, error) {
	if purpose == "download" || purpose == "playback" {
		if originalRef == "" {
			return "", apierror.New(409, "ASSET_NOT_READY", "source file is unavailable", map[string]any{"assetId": assetID})
		}
		return originalRef, nil
	}
	renderer := ""
	switch kind {
	case "html":
		renderer = "sandboxed-html"
	case "image", "pdf":
		// Browser preview of these formats intentionally uses the original object.
		if originalRef == "" {
			return "", apierror.New(409, "PREVIEW_UNAVAILABLE", "preview unavailable", map[string]any{"assetId": assetID})
		}
		return originalRef, nil
	case "audio":
		renderer = "audio-waveform"
	case "video":
		renderer = "video-poster"
	}
	if renderer == "" {
		return "", apierror.New(409, "PREVIEW_UNAVAILABLE", "preview unavailable", map[string]any{"assetId": assetID})
	}
	var artifactRef sql.NullString
	var status string
	err := s.DB.QueryRowContext(ctx, `SELECT artifact_ref,status FROM preview_artifacts WHERE asset_id=$1 AND renderer=$2`, assetID, renderer).Scan(&artifactRef, &status)
	if err != nil || status != "ready" || !artifactRef.Valid || artifactRef.String == "" {
		return "", apierror.New(409, "PREVIEW_UNAVAILABLE", "preview unavailable", map[string]any{"assetId": assetID})
	}
	return artifactRef.String, nil
}
func textExtension(n string) bool {
	switch strings.ToLower(filepath.Ext(n)) {
	case ".md", ".markdown", ".txt", ".text":
		return true
	}
	return false
}
func detect(name, mimeType string, raw []byte) (domain.AssetKind, string, error) {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(raw)
	}
	if mimeType == "" {
		mimeType = mime.TypeByExtension("." + ext)
	}
	if one(ext, "apng", "avif", "bmp", "gif", "heic", "heif", "jpg", "jpeg", "png", "svg", "webp") && !imageSignature(ext, raw) {
		return "", "", fmt.Errorf("mime-mismatch")
	}
	if ext == "pdf" && strings.HasPrefix(string(raw), "%PDF-") {
		return domain.AssetPDF, ext, nil
	}
	if isOffice(ext, raw) {
		return domain.AssetOffice, ext, nil
	}
	if strings.HasPrefix(mimeType, "image/") && one(ext, "apng", "avif", "bmp", "gif", "heic", "heif", "jpg", "jpeg", "png", "svg", "webp") {
		return domain.AssetImage, ext, nil
	}
	if one(ext, "aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "weba") || strings.HasPrefix(mimeType, "audio/") {
		return domain.AssetAudio, ext, nil
	}
	if one(ext, "avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm") || strings.HasPrefix(mimeType, "video/") {
		return domain.AssetVideo, ext, nil
	}
	if one(ext, "html", "htm") && (strings.HasPrefix(mimeType, "text/html") || looksHTML(raw)) {
		return domain.AssetHTML, "html", nil
	}
	if ext == "zip" && (mimeType == "application/zip" || mimeType == "application/x-zip-compressed" || hasZIPSignature(raw)) {
		return domain.AssetHTML, "zip", nil
	}
	if one(ext, "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx") {
		return "", "", fmt.Errorf("mime-mismatch")
	}
	return "", "", fmt.Errorf("unsupported-format")
}
func looksHTML(raw []byte) bool {
	value := strings.ToLower(strings.TrimSpace(string(raw)))
	return strings.HasPrefix(value, "<!doctype html") || strings.HasPrefix(value, "<html")
}
func hasZIPSignature(raw []byte) bool { return len(raw) >= 4 && string(raw[:4]) == "PK\x03\x04" }
func imageSignature(ext string, raw []byte) bool {
	if ext == "svg" {
		return strings.Contains(strings.ToLower(string(raw[:min(len(raw), 1024)])), "<svg")
	}
	if len(raw) < 4 {
		return false
	}
	switch ext {
	case "jpg", "jpeg":
		return raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
	case "png", "apng":
		return string(raw[:4]) == "\x89PNG"
	case "gif":
		return string(raw[:3]) == "GIF"
	case "bmp":
		return string(raw[:2]) == "BM"
	case "webp":
		return len(raw) >= 12 && string(raw[:4]) == "RIFF" && string(raw[8:12]) == "WEBP"
	case "avif":
		return len(raw) >= 12 && string(raw[4:8]) == "ftyp"
	}
	return false
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func isOffice(ext string, b []byte) bool {
	return one(ext, "doc", "docx", "xls", "xlsx", "ppt", "pptx") && (len(b) >= 8 && string(b[:8]) == "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" || len(b) >= 4 && string(b[:2]) == "PK")
}
func one(v string, a ...string) bool {
	for _, x := range a {
		if v == x {
			return true
		}
	}
	return false
}
func rendererFor(k domain.AssetKind, format string) string {
	switch k {
	case domain.AssetAudio:
		return "audio-waveform"
	case domain.AssetVideo:
		return "video-poster"
	case domain.AssetHTML:
		return "sandboxed-html"
	}
	return ""
}
func newID() string { return uuid.NewString() }

var _ = http.MethodPost

// CreateWeb persists only the normalized external URL. The client renders it directly in a restricted iframe; no server-side browsing occurs.
func (s *Service) CreateWeb(ctx context.Context, p, rawURL, displayName string, validate func(context.Context, string) (string, error)) (ad.Asset, error) {
	if e := s.Auth.Require(ctx, p, "project:write"); e != nil {
		return ad.Asset{}, e
	}
	normalized, e := validate(ctx, rawURL)
	if e != nil {
		return ad.Asset{}, apierror.Validation("invalid web URL", map[string]string{"url": e.Error()})
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = normalized
	}
	id := newID()
	meta, _ := json.Marshal(map[string]any{"canonicalUrl": normalized})
	processing, _ := json.Marshal(map[string]any{"state": "ready"})
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return ad.Asset{}, e
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(ctx, `INSERT INTO assets(id,project_id,kind,display_name,source_type,normalized_url,mime_type,format,byte_size,metadata,processing) VALUES($1,$2,'web',$3,'external-url',$4,'text/html','url',NULL,$5::jsonb,$6::jsonb)`, id, p, displayName, normalized, meta, processing)
	if e != nil {
		return ad.Asset{}, e
	}
	if e = tx.Commit(); e != nil {
		return ad.Asset{}, e
	}
	return ad.Asset{ID: id, ProjectID: p, Kind: "web", DisplayName: displayName, ProcessingState: "ready"}, nil
}

func (s *Service) NowOrSystem() time.Time { return s.now() }
