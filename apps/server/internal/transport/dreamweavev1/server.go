// Package dreamweavev1 binds the generated Dream Weave HTTP transport to the
// existing application services. Proto messages are the only public HTTP DTOs.
package dreamweavev1

import (
	"net/http"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	canvas "github.com/dream-weave/dream-weave/apps/server/internal/canvas/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
	"github.com/dream-weave/dream-weave/apps/server/internal/office"
	"github.com/dream-weave/dream-weave/apps/server/internal/projects"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

// Services contains the application services exposed through generated HTTP
// bindings. Native byte-delivery and private Office proxy routes stay outside
// this public transport.
type Services struct {
	Identity *identity.Service
	Projects *projects.Service
	Canvas   *canvas.Service
	Assets   *assets.Service
	Office   *office.Service
}

// NewHandler registers every public API through protoc-gen-go-http output.
func NewHandler(services Services, registerNative func(*khttp.Server)) http.Handler {
	server := khttp.NewServer(
		khttp.RequestDecoder(decodeProtoJSON),
		khttp.ResponseEncoder(encodeProtoJSON),
		khttp.ErrorEncoder(encodeAPIError),
		khttp.StrictSlash(false),
	)

	v1.RegisterAuthServiceHTTPServer(server, &authTransport{identity: services.Identity})
	v1.RegisterProjectServiceHTTPServer(server, &projectTransport{projects: services.Projects})
	v1.RegisterCanvasServiceHTTPServer(server, &canvasTransport{canvas: services.Canvas})
	v1.RegisterAssetServiceHTTPServer(server, &assetTransport{assets: services.Assets})
	v1.RegisterOfficeServiceHTTPServer(server, &officeTransport{office: services.Office})
	if registerNative != nil {
		registerNative(server)
	}
	return services.Identity.Middleware(server)
}
