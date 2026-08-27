package dreamweavev1

import (
	"context"
	"net/http"
	"time"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
	"google.golang.org/protobuf/types/known/emptypb"
)

type authTransport struct {
	v1.UnimplementedAuthServiceServer
	identity *identity.Service
}

func (t *authTransport) CreateSession(ctx context.Context, request *v1.CreateSessionRequest) (*v1.CurrentPrincipal, error) {
	principal, token, err := t.identity.CreateSession(ctx, request.GetEmail(), request.GetPassword())
	if err != nil {
		return nil, err
	}
	ttl := t.identity.SessionTTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	khttp.SetCookie(ctx, &http.Cookie{
		Name:     identity.CookieName,
		Value:    token,
		Path:     "/api/dreamweave/v1",
		HttpOnly: true,
		Secure:   t.identity.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ttl.Seconds()),
	})
	return &v1.CurrentPrincipal{UserId: principal.ID, Email: principal.Email}, nil
}

func (t *authTransport) DeleteCurrentSession(ctx context.Context, _ *emptypb.Empty) (*emptypb.Empty, error) {
	request, ok := khttp.RequestFromServerContext(ctx)
	if ok {
		if cookie, err := request.Cookie(identity.CookieName); err == nil {
			if err := t.identity.DeleteCurrent(ctx, cookie.Value); err != nil {
				return nil, err
			}
		}
	}
	khttp.SetCookie(ctx, &http.Cookie{
		Name:     identity.CookieName,
		Path:     "/api/dreamweave/v1",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   t.identity.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return &emptypb.Empty{}, nil
}
