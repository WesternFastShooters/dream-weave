package dreamweavev1

import (
	"context"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	assetsdomain "github.com/dream-weave/dream-weave/apps/server/internal/assets/domain"
	assets "github.com/dream-weave/dream-weave/apps/server/internal/assets/service"
	"github.com/dream-weave/dream-weave/apps/server/internal/preview"
)

type assetTransport struct {
	v1.UnimplementedAssetServiceServer
	assets *assets.Service
}

func (t *assetTransport) CreateAssetUpload(ctx context.Context, request *v1.CreateAssetUploadRequest) (*v1.AssetUploadTicket, error) {
	ticket, err := t.assets.CreateUpload(ctx, request.GetProjectId(), request.GetFileName(), request.GetDeclaredMimeType(), request.GetByteSize())
	if err != nil {
		return nil, err
	}
	return uploadTicketToProto(ticket), nil
}

func (t *assetTransport) CompleteAssetUpload(ctx context.Context, request *v1.CompleteAssetUploadRequest) (*v1.Asset, error) {
	asset, err := t.assets.Complete(ctx, request.GetProjectId(), request.GetUploadId())
	if err != nil {
		return nil, err
	}
	return assetToProto(asset), nil
}

func (t *assetTransport) CreateWebAsset(ctx context.Context, request *v1.CreateWebAssetRequest) (*v1.Asset, error) {
	asset, err := t.assets.CreateWeb(ctx, request.GetProjectId(), request.GetUrl(), request.GetDisplayName(), func(_ context.Context, raw string) (string, error) {
		url, err := preview.ValidateHTTPSURL(raw)
		if err != nil {
			return "", err
		}
		return url.String(), nil
	})
	if err != nil {
		return nil, err
	}
	return assetToProto(asset), nil
}

func (t *assetTransport) GetPreviewAccess(ctx context.Context, request *v1.GetAssetAccessRequest) (*v1.AssetAccess, error) {
	return t.access(ctx, request, "preview")
}
func (t *assetTransport) GetDownloadAccess(ctx context.Context, request *v1.GetAssetAccessRequest) (*v1.AssetAccess, error) {
	return t.access(ctx, request, "download")
}
func (t *assetTransport) GetPlaybackAccess(ctx context.Context, request *v1.GetAssetAccessRequest) (*v1.AssetAccess, error) {
	return t.access(ctx, request, "playback")
}
func (t *assetTransport) GetHtmlPreviewAccess(ctx context.Context, request *v1.GetAssetAccessRequest) (*v1.AssetAccess, error) {
	return t.access(ctx, request, "html-preview")
}
func (t *assetTransport) access(ctx context.Context, request *v1.GetAssetAccessRequest, purpose string) (*v1.AssetAccess, error) {
	access, err := t.assets.Access(ctx, request.GetProjectId(), request.GetAssetId(), purpose)
	if err != nil {
		return nil, err
	}
	return &v1.AssetAccess{Url: access.URL, ExpiresAt: access.ExpiresAt, FileName: access.FileName}, nil
}

func uploadTicketToProto(ticket assetsdomain.UploadTicket) *v1.AssetUploadTicket {
	return &v1.AssetUploadTicket{UploadId: ticket.UploadID, UploadUrl: ticket.UploadURL, Method: ticket.Method, RequiredHeaders: ticket.RequiredHeaders, ExpiresAt: ticket.ExpiresAt}
}
func assetToProto(asset assetsdomain.Asset) *v1.Asset {
	return &v1.Asset{Id: asset.ID, ProjectId: asset.ProjectID, Kind: asset.Kind, DisplayName: asset.DisplayName, ProcessingState: asset.ProcessingState}
}
