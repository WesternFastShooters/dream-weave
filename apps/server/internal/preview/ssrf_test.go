package preview

import "testing"

func TestValidateHTTPSURLRejectsExplicitDangerousIPAndNonHTTPSWithoutDNS(t *testing.T) {
	if _, e := ValidateHTTPSURL("http://public.example"); e == nil {
		t.Fatal("http accepted")
	}
	if _, e := ValidateHTTPSURL("https://user@public.example"); e == nil {
		t.Fatal("userinfo accepted")
	}
	if _, e := ValidateHTTPSURL("https://127.0.0.1"); e == nil {
		t.Fatal("loopback literal accepted")
	}
	// Hostnames are intentionally never resolved: this URL is ultimately
	// fetched by the browser, not the server.
	if _, e := ValidateHTTPSURL("https://private.example:8443/path"); e != nil {
		t.Fatalf("hostname URL rejected: %v", e)
	}
	if _, e := ValidateHTTPSURL("https://public.example/path"); e != nil {
		t.Fatal(e)
	}
}
