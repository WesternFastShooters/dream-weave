package dreamweavev1

import (
	"context"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"github.com/dream-weave/dream-weave/apps/server/internal/office"
)

type officeTransport struct {
	v1.UnimplementedOfficeServiceServer
	office *office.Service
}

func (t *officeTransport) CreateOfficeSession(ctx context.Context, request *v1.CreateOfficeSessionRequest) (*v1.OfficeViewerSessionRuntimeConfig, error) {
	config, err := t.office.Create(ctx, request.GetProjectId(), request.GetAssetId())
	if err != nil {
		return nil, err
	}
	return &v1.OfficeViewerSessionRuntimeConfig{
		SessionId: config.SessionID, DocumentServerUrl: config.DocumentServerURL,
		DocumentUrl: config.DocumentURL, DocumentKey: config.DocumentKey, Token: config.Token,
		DocumentTitle: config.DocumentTitle, FileType: config.FileType,
		DocumentType: config.DocumentType, ExpiresAt: config.ExpiresAt,
	}, nil
}
