// Package app assembles the only Dream Weave server HTTP surface.
package app

import (
	"database/sql"
	"github.com/dream-weave/dream-weave/apps/server/internal/assets/domain"
	assethttp "github.com/dream-weave/dream-weave/apps/server/internal/assets/http"
	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/repository"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
	"github.com/dream-weave/dream-weave/apps/server/internal/office"
	"github.com/dream-weave/dream-weave/apps/server/internal/projects"
	"github.com/dream-weave/dream-weave/apps/server/internal/resourceaccess"
	transportv1 "github.com/dream-weave/dream-weave/apps/server/internal/transport/dreamweavev1"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	AppOrigin                 string
	PreviewOrigin             string
	CapabilitySecret          []byte
	Store                     domain.ObjectStore
	CookieSecure              bool
	OfficeDocumentServerURL   string
	OfficeSourceProxyBase     string
	OfficeDocumentServerCIDRs []*net.IPNet
	OnlyOfficeJWTSecret       []byte
}

func New(db *sql.DB, c Config) http.Handler {
	projectsSvc := &projects.Service{DB: db}
	auth := &identity.Service{DB: db, AppOrigin: c.AppOrigin, CookieSecure: c.CookieSecure, SessionTTL: 24 * time.Hour}
	canvas := &service.Service{Repo: repository.New(db), Auth: projectsSvc}
	signer := resourceaccess.Signer{Secret: c.CapabilitySecret}
	assetSvc := &assets.Service{DB: db, Store: c.Store, Auth: projectsSvc, Capabilities: signer, MaxUploadBytes: 1 << 30, PreviewOrigin: c.PreviewOrigin, PreviewFrameAncestor: c.AppOrigin}
	officeSvc := &office.Service{DB: db, Store: c.Store, Auth: projectsSvc, Capabilities: signer, DocumentServerURL: c.OfficeDocumentServerURL, SourceProxyBase: c.OfficeSourceProxyBase, DocumentServerCIDRs: c.OfficeDocumentServerCIDRs, OnlyOfficeJWTSecret: c.OnlyOfficeJWTSecret}
	return transportv1.NewHandler(transportv1.Services{
		Identity: auth,
		Projects: projectsSvc,
		Canvas:   canvas,
		Assets:   assetSvc,
		Office:   officeSvc,
	}, func(server *khttp.Server) {
		server.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		server.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
			if err := db.Ping(); err != nil {
				http.Error(w, "database unavailable", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		})
		assethttp.Handler{Assets: assetSvc}.RegisterNative(server)
		server.HandlePrefix("/internal/office-viewer-sessions/", officeSvc.ViewerSessionHandler())
	})
}

// NewOfficeSourceProxy creates the narrowly scoped private listener used by
// ONLYOFFICE. It is deliberately separate from the public application mux.
func NewOfficeSourceProxy(db *sql.DB, c Config) http.Handler {
	projectsSvc := &projects.Service{DB: db}
	svc := &office.Service{DB: db, Store: c.Store, Auth: projectsSvc, Capabilities: resourceaccess.Signer{Secret: c.CapabilitySecret}, DocumentServerCIDRs: c.OfficeDocumentServerCIDRs}
	return svc.SourceProxyHandler()
}
func DefaultConfig() Config {
	return Config{AppOrigin: os.Getenv("DW_APP_ORIGIN"), PreviewOrigin: os.Getenv("DW_PREVIEW_ORIGIN"), CapabilitySecret: []byte(os.Getenv("DW_CAPABILITY_SECRET")), CookieSecure: true, OfficeDocumentServerURL: os.Getenv("DW_ONLYOFFICE_DOCUMENT_SERVER_URL"), OfficeSourceProxyBase: os.Getenv("DW_OFFICE_SOURCE_PROXY_BASE"), OfficeDocumentServerCIDRs: parseCIDRs(os.Getenv("DW_OFFICE_DOCUMENT_SERVER_CIDRS")), OnlyOfficeJWTSecret: []byte(os.Getenv("ONLYOFFICE_JWT_SECRET"))}
}

// ValidOrigin accepts only a bare HTTP(S) origin. It is used for the preview
// host and CSP frame-ancestors value, never as an arbitrary CSP fragment.
func ValidOrigin(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}
func parseCIDRs(raw string) []*net.IPNet {
	var result []*net.IPNet
	for _, value := range strings.Split(raw, ",") {
		if _, cidr, err := net.ParseCIDR(strings.TrimSpace(value)); err == nil {
			result = append(result, cidr)
		}
	}
	return result
}
