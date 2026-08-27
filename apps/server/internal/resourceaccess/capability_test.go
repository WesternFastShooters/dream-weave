package resourceaccess

import (
	"testing"
	"time"
)

func TestCapabilitiesArePurposeAndAudienceBound(t *testing.T) {
	s := Signer{Secret: []byte("01234567890123456789012345678901")}
	now := time.Unix(100, 0)
	token, e := s.Issue(Claims{AssetID: "a", Purpose: "download", Audience: "browser", ExpiresAt: 101})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Verify(token, "preview", "browser", now); e == nil {
		t.Fatal("purpose confusion")
	}
	if _, e = s.Verify(token, "download", "office", now); e == nil {
		t.Fatal("audience confusion")
	}
	if _, e = s.Verify(token, "download", "browser", time.Unix(101, 0)); e == nil {
		t.Fatal("expiry accepted")
	}
}
