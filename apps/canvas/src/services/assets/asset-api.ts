import type { AssetRuntimeTransport, CreatedWebAsset, OfficeSessionConfig } from '@dream-weave/canvas-core';
import type { AssetAccess, AssetService, OfficeService } from '@dream-weave/canvas-core/generated';
import type { DreamWeaveNetworkRuntime } from '../network/create-network-client.js';

export type UploadedAssetKind = 'image' | 'audio' | 'video' | 'html' | 'pdf' | 'office';
export interface UploadedAsset { id: string; kind: UploadedAssetKind; displayName: string; processingState: string; }

/** Domain adapter around generated AssetService and OfficeService clients. */
export class AssetApi implements AssetRuntimeTransport {
  constructor(
    private readonly assets: AssetService,
    private readonly office: OfficeService,
    private readonly network: DreamWeaveNetworkRuntime
  ) {}

  async getPreviewAccess(projectId: string, assetId: string) { return toAccess(await this.assets.GetPreviewAccess({ projectId, assetId })); }
  async getPlaybackAccess(projectId: string, assetId: string) { return toAccess(await this.assets.GetPlaybackAccess({ projectId, assetId })); }
  async getHtmlPreviewAccess(projectId: string, assetId: string) { return toAccess(await this.assets.GetHtmlPreviewAccess({ projectId, assetId })); }
  async getDownloadAccess(projectId: string, assetId: string) { return toAccess(await this.assets.GetDownloadAccess({ projectId, assetId })); }

  async createWebAsset(projectId: string, url: string, displayName: string): Promise<CreatedWebAsset> {
    const asset = await this.assets.CreateWebAsset({ projectId, url, displayName });
    return { id: requiredString(asset.id, 'id'), displayName: requiredString(asset.displayName, 'displayName') };
  }

  async createOfficeSession(projectId: string, assetId: string): Promise<OfficeSessionConfig> {
    const session = await this.office.CreateOfficeSession({ projectId, assetId });
    return {
      sessionId: requiredString(session.sessionId, 'sessionId'),
      documentServerUrl: requiredString(session.documentServerUrl, 'documentServerUrl'),
      documentUrl: requiredString(session.documentUrl, 'documentUrl'),
      documentKey: requiredString(session.documentKey, 'documentKey'),
      token: requiredString(session.token, 'token'),
      documentTitle: requiredString(session.documentTitle, 'documentTitle'),
      fileType: requiredOneOf(session.fileType, 'fileType', ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'] as const),
      documentType: requiredOneOf(session.documentType, 'documentType', ['word', 'cell', 'slide', 'pdf'] as const),
      expiresAt: requiredString(session.expiresAt, 'expiresAt'),
    };
  }

  async upload(projectId: string, file: File): Promise<UploadedAsset> {
    const ticket = await this.assets.CreateAssetUpload({
      projectId,
      fileName: file.name,
      declaredMimeType: file.type || 'application/octet-stream',
      byteSize: String(file.size),
    });
    const method = requiredString(ticket.method, 'method');
    if (method !== 'PUT') throw new Error('Asset upload API returned an unsupported method.');
    await this.network.put(requiredString(ticket.uploadUrl, 'uploadUrl'), file, ticket.requiredHeaders ?? {});
    const asset = await this.assets.CompleteAssetUpload({ projectId, uploadId: requiredString(ticket.uploadId, 'uploadId') });
    return {
      id: requiredString(asset.id, 'id'),
      kind: requiredOneOf(asset.kind, 'kind', ['image', 'audio', 'video', 'html', 'pdf', 'office'] as const),
      displayName: requiredString(asset.displayName, 'displayName'),
      processingState: requiredString(asset.processingState, 'processingState'),
    };
  }
}

function toAccess(access: AssetAccess): { url: string; expiresAt: string; fileName?: string } {
  const result = { url: requiredString(access.url, 'url'), expiresAt: requiredString(access.expiresAt, 'expiresAt') };
  return access.fileName ? { ...result, fileName: access.fileName } : result;
}
function requiredString(value: string | undefined, field: string): string {
  if (!value) throw new Error(`Asset API returned invalid ${field}.`);
  return value;
}
function requiredOneOf<T extends string>(value: string | undefined, field: string, values: readonly T[]): T {
  const required = requiredString(value, field);
  if ((values as readonly string[]).includes(required)) return required as T;
  throw new Error(`Asset API returned invalid ${field}.`);
}
