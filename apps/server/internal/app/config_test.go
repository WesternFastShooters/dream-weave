package app

import "testing"

func TestValidOriginAcceptsOnlyBareHTTPOrigins(t *testing.T) {
	for _, value := range []string{"https://app.example", "http://localhost:3000"} {
		if !ValidOrigin(value) {
			t.Fatalf("ValidOrigin(%q) = false", value)
		}
	}
	for _, value := range []string{"", "https://app.example/path", "https://user@app.example", "javascript:alert(1)"} {
		if ValidOrigin(value) {
			t.Fatalf("ValidOrigin(%q) = true", value)
		}
	}
}
