// Package identity resolves only server-side cookie sessions; clients never receive session tokens.
package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
)

const CookieName = "dw_session"

type Principal struct {
	ID    string
	Email string
}
type Service struct {
	DB           *sql.DB
	AppOrigin    string
	CookieSecure bool
	SessionTTL   time.Duration
}
type principalKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if strings.TrimSpace(r.Header.Get("Origin")) != s.AppOrigin {
				apierror.Write(w, apierror.Forbidden())
				return
			}
		}
		c, err := r.Cookie(CookieName)
		if err == nil {
			if p, e := s.resolve(r.Context(), c.Value); e == nil {
				r = r.WithContext(WithPrincipal(r.Context(), p))
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Service) CreateSession(ctx context.Context, email, password string) (Principal, string, error) {
	var p Principal
	var hash string
	err := s.DB.QueryRowContext(ctx, `SELECT id,email,password_hash FROM users WHERE email=$1 AND enabled=true`, strings.TrimSpace(email)).Scan(&p.ID, &p.Email, &hash)
	if err != nil || !verifyPassword(hash, password) {
		return Principal{}, "", apierror.New(http.StatusUnauthorized, "UNAUTHENTICATED", "invalid credentials", nil)
	}
	raw, err := randomToken()
	if err != nil {
		return p, "", err
	}
	tokenHash := digest(raw)
	ttl := s.SessionTTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(gen_random_uuid(),$1,$2,$3)`, p.ID, tokenHash, time.Now().UTC().Add(ttl))
	if err != nil {
		return p, "", err
	}
	return p, raw, nil
}
func (s *Service) DeleteCurrent(ctx context.Context, raw string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, digest(raw))
	return err
}
func (s *Service) resolve(ctx context.Context, raw string) (Principal, error) {
	var p Principal
	err := s.DB.QueryRowContext(ctx, `SELECT u.id,u.email FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.enabled=true`, digest(raw)).Scan(&p.ID, &p.Email)
	return p, err
}

// verifyPassword accepts only the versioned Argon2id PHC format. Plaintext
// and malformed hashes deliberately fail without leaking parse details.
func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint64
	var iterations uint32
	var parallelism uint8
	for _, value := range strings.Split(parts[3], ",") {
		key, raw, ok := strings.Cut(value, "=")
		if !ok {
			return false
		}
		switch key {
		case "m":
			memory, _ = strconv.ParseUint(raw, 10, 32)
		case "t":
			value, err := strconv.ParseUint(raw, 10, 32)
			if err != nil {
				return false
			}
			iterations = uint32(value)
		case "p":
			value, err := strconv.ParseUint(raw, 10, 8)
			if err != nil {
				return false
			}
			parallelism = uint8(value)
		default:
			return false
		}
	}
	if memory < 8*1024 || memory > 1024*1024 || iterations == 0 || iterations > 10 || parallelism == 0 || parallelism > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, uint32(memory), parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

// BootstrapAdmin creates exactly one administrator in an empty users table.
// The caller supplies deployment secrets at startup; neither value is stored
// outside the Argon2id hash or returned to an HTTP client.
func (s *Service) BootstrapAdmin(ctx context.Context, email, password string) error {
	email = strings.TrimSpace(email)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// A transaction-scoped advisory lock makes concurrent server starts observe
	// the same empty/non-empty users state.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(734901282349)`); err != nil {
		return err
	}
	var users int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&users); err != nil {
		return err
	}
	if users != 0 {
		return tx.Commit()
	}
	if email == "" || password == "" {
		return fmt.Errorf("bootstrap admin email and password are required for an empty users table")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO users(id,email,password_hash,enabled) VALUES(gen_random_uuid(),$1,$2,true)`, email, hash); err != nil {
		return err
	}
	return tx.Commit()
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const memory uint32 = 64 * 1024
	const iterations uint32 = 3
	const parallelism uint8 = 1
	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, 32)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", memory, iterations, parallelism, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", fmt.Errorf("random session token: %w", e)
	}
	return hex.EncodeToString(b), nil
}
func digest(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
