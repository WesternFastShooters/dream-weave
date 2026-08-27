// Package http exposes the native byte-delivery route that cannot be modeled as
// a JSON protobuf response. Public Asset API routes use generated bindings.
package http

import (
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

type Handler struct{ Assets *assets.Service }

func (h Handler) RegisterNative(server *khttp.Server) {
	delivery := func(ctx khttp.Context) error {
		h.delivery(ctx.Response(), ctx.Request(), ctx.Vars().Get("purpose"), ctx.Vars().Get("capability"))
		return nil
	}
	route := server.Route("/")
	route.GET("/internal/asset-access/{purpose}/{capability}", delivery)
	route.HEAD("/internal/asset-access/{purpose}/{capability}", delivery)
}

// delivery is a same-origin byte proxy. It preserves Range responses so media
// elements can seek, while keeping the MinIO endpoint and signed URL private.
func (h Handler) delivery(w http.ResponseWriter, r *http.Request, purpose, capability string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if value := r.Header.Get("Range"); value != "" && !isSingleRange(value) {
		w.Header().Set("Content-Range", "bytes */0")
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	delivery, err := h.Assets.Delivery(r.Context(), purpose, capability)
	if err != nil {
		apierror.Write(w, err)
		return
	}
	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, delivery.URL, nil)
	if err != nil {
		apierror.Write(w, err)
		return
	}
	if value := r.Header.Get("Range"); value != "" {
		upstream.Header.Set("Range", value)
	}
	response, err := http.DefaultClient.Do(upstream)
	if err != nil {
		apierror.Write(w, err)
		return
	}
	defer response.Body.Close()
	for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	setPurposeResponseHeaders(w.Header(), purpose, h.Assets.PreviewFrameAncestor)
	if purpose == "download" {
		w.Header().Set("Content-Disposition", attachmentDisposition(delivery.FileName))
	}
	w.WriteHeader(response.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, response.Body)
	}
}

func isSingleRange(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "bytes=") && !strings.Contains(value, ",") && len(strings.TrimSpace(strings.TrimPrefix(value, "bytes="))) > 0
}

func attachmentDisposition(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "download"
	}
	return mime.FormatMediaType("attachment", map[string]string{"filename": name})
}

func setPurposeResponseHeaders(header http.Header, purpose, frameAncestor string) {
	if purpose == "download" {
		return
	}
	if purpose != "html-preview" {
		return
	}
	header.Set("Content-Type", "text/html; charset=utf-8")
	if frameAncestor == "" {
		frameAncestor = "'none'"
	}
	header.Set("Content-Security-Policy", "default-src 'none'; script-src data:; style-src data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+frameAncestor+"; navigate-to 'none'")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("Cache-Control", "private, no-store")
	header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}
