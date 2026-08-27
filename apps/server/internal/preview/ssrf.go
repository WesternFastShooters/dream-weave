// Package preview validates URLs which the *browser*, rather than the server,
// will visit.  Resolving a hostname here would provide a false SSRF guarantee
// and creates a DNS-rebinding dependency, so only explicit IP literals are
// screened.
package preview

import (
	"fmt"
	"net/netip"
	"net/url"
)

func ValidateHTTPSURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return nil, fmt.Errorf("url must be an absolute https URL without user information")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && blocked(ip) {
		return nil, fmt.Errorf("unsafe destination")
	}
	return u, nil
}

func blocked(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// RFC 6598 shared address space is not covered by Addr.IsPrivate.
	if ip.Is4() {
		octets := ip.As4()
		return octets[0] == 100 && octets[1]&0xc0 == 0x40
	}
	return false
}

type RedirectPolicy struct {
	MaxRedirects int
}

// Check has no redirect-following side effect; callers use it only to validate
// a browser-provided URL before persisting it.
func (p RedirectPolicy) Check(raw string, hops int) (*url.URL, error) {
	if hops > p.MaxRedirects {
		return nil, fmt.Errorf("too many redirects")
	}
	return ValidateHTTPSURL(raw)
}
