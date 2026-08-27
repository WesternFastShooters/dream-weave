// Package resourceaccess issues purpose-bound, short-lived capabilities. They never enter canvas snapshots.
package resourceaccess

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

type Claims struct {
	AssetID   string `json:"assetId"`
	Purpose   string `json:"purpose"`
	ExpiresAt int64  `json:"expiresAt"`
	Audience  string `json:"audience,omitempty"`
}
type Signer struct{ Secret []byte }

func (s Signer) Issue(c Claims) (string, error) {
	if len(s.Secret) < 32 {
		return "", errors.New("capability secret must be at least 32 bytes")
	}
	b, e := json.Marshal(c)
	if e != nil {
		return "", e
	}
	m := hmac.New(sha256.New, s.Secret)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil)), nil
}
func (s Signer) Verify(token, purpose, audience string, now time.Time) (Claims, error) {
	var c Claims
	parts := split(token)
	if len(parts) != 2 {
		return c, errors.New("invalid capability")
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return c, e
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return c, e
	}
	m := hmac.New(sha256.New, s.Secret)
	m.Write(b)
	if !hmac.Equal(sig, m.Sum(nil)) {
		return c, errors.New("invalid capability")
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return c, e
	}
	if c.Purpose != purpose || c.Audience != audience || now.Unix() >= c.ExpiresAt {
		return c, errors.New("expired or wrong capability")
	}
	return c, nil
}
func split(s string) []string {
	for i := range s {
		if s[i] == '.' {
			return []string{s[:i], s[i+1:]}
		}
	}
	return nil
}
