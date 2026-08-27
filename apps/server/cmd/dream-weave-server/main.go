package main

import (
	"context"
	"database/sql"
	"github.com/dream-weave/dream-weave/apps/server/internal/app"
	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
	_ "github.com/jackc/pgx/v5/stdlib"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required; install/configure a PostgreSQL database and register its database/sql driver")
	}
	db, e := sql.Open("pgx", dsn)
	if e != nil {
		log.Fatal(e)
	}
	defer db.Close()
	if e = db.Ping(); e != nil {
		log.Fatalf("postgres unavailable: %v", e)
	}
	cfg := app.DefaultConfig()
	bootstrap := &identity.Service{DB: db, SessionTTL: 24 * time.Hour}
	if e = bootstrap.BootstrapAdmin(context.Background(), os.Getenv("DW_BOOTSTRAP_ADMIN_EMAIL"), os.Getenv("DW_BOOTSTRAP_ADMIN_PASSWORD")); e != nil {
		log.Fatalf("bootstrap administrator: %v", e)
	}
	store, e := assets.S3FromEnvironment()
	if e != nil {
		log.Fatal(e)
	}
	cfg.Store = store
	if !app.ValidOrigin(cfg.AppOrigin) || !app.ValidOrigin(cfg.PreviewOrigin) || cfg.AppOrigin == cfg.PreviewOrigin || len(cfg.CapabilitySecret) < 32 {
		log.Fatal("DW_APP_ORIGIN and distinct DW_PREVIEW_ORIGIN must be bare origins, and DW_CAPABILITY_SECRET must be >=32 bytes")
	}
	if cfg.OfficeDocumentServerURL == "" || cfg.OfficeSourceProxyBase == "" || len(cfg.OfficeDocumentServerCIDRs) == 0 || len(cfg.OnlyOfficeJWTSecret) < 32 {
		log.Fatal("DW_ONLYOFFICE_DOCUMENT_SERVER_URL, DW_OFFICE_SOURCE_PROXY_BASE, DW_OFFICE_DOCUMENT_SERVER_CIDRS and a >=32-byte ONLYOFFICE_JWT_SECRET are required")
	}
	proxyPort := os.Getenv("DW_OFFICE_SOURCE_PROXY_PORT")
	if proxyPort == "" {
		proxyPort = "8081"
	}
	go func() { log.Fatal(http.ListenAndServe(":"+proxyPort, app.NewOfficeSourceProxy(db, cfg))) }()
	listenAddr := os.Getenv("DW_HTTP_ADDR")
	if listenAddr == "" {
		listenAddr = ":8080"
	}
	log.Fatal(http.ListenAndServe(listenAddr, app.New(db, cfg)))
}
