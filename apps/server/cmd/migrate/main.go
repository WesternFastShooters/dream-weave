// Command migrate applies the ordered SQL migrations exactly once per database.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	migrationsDir := os.Getenv("DW_MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "migrations"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect to postgres: %v", err)
	}
	defer conn.Close(ctx)

	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(440981342192)"); err != nil {
		log.Fatalf("lock migrations: %v", err)
	}
	defer func() { _, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock(440981342192)") }()
	if _, err = conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		log.Fatalf("create migration ledger: %v", err)
	}

	files, err := filepath.Glob(filepath.Join(migrationsDir, "*.up.sql"))
	if err != nil {
		log.Fatalf("find migrations: %v", err)
	}
	sort.Strings(files)
	if len(files) == 0 {
		log.Fatalf("no migration files found in %s", migrationsDir)
	}
	// Older local installations created the original schema before the migration
	// ledger existed. Record that known complete baseline once, then apply every
	// later additive/repair migration normally. A fresh database has no users
	// table and still executes 000001 itself.
	if err = recordLegacyBaseline(ctx, conn, "000001_project_auth_canvas_assets"); err != nil {
		log.Fatalf("record legacy baseline: %v", err)
	}
	for _, path := range files {
		id := strings.TrimSuffix(filepath.Base(path), ".up.sql")
		var applied bool
		if err = conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE id=$1)`, id).Scan(&applied); err != nil {
			log.Fatalf("read migration ledger for %s: %v", id, err)
		}
		if applied {
			continue
		}
		sql, readErr := os.ReadFile(path)
		if readErr != nil {
			log.Fatalf("read %s: %v", path, readErr)
		}
		tx, beginErr := conn.Begin(ctx)
		if beginErr != nil {
			log.Fatalf("begin %s: %v", id, beginErr)
		}
		if _, err = tx.Exec(ctx, string(sql)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations(id) VALUES($1)`, id)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			log.Fatalf("apply %s: %v", id, err)
		}
		if err = tx.Commit(ctx); err != nil {
			log.Fatalf("commit %s: %v", id, err)
		}
		log.Printf("applied migration %s", id)
	}
	fmt.Println("migrations complete")
}

func recordLegacyBaseline(ctx context.Context, conn *pgx.Conn, id string) error {
	var usersTableExists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='users')`).Scan(&usersTableExists); err != nil {
		return err
	}
	if !usersTableExists {
		return nil
	}
	_, err := conn.Exec(ctx, `INSERT INTO schema_migrations(id) VALUES($1) ON CONFLICT (id) DO NOTHING`, id)
	return err
}
