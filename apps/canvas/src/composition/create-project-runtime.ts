import {
  CanvasNodeToolbarService,
  CreativeNodeService,
  type NodeRuntimeServices,
} from '@dream-weave/creative-nodes';
import {
  HttpAssetDownloadService,
  HttpAssetPlaybackService,
  HttpAssetPreviewService,
  HttpOfficeViewerSessionProvider,
  type ICanvasAssetUploadService,
  type ICanvasDocumentService,
  type ICanvasHistoryService,
  type Placement,
} from '@dream-weave/canvas-core';
import { createAssetServiceClient, createCanvasServiceClient, createOfficeServiceClient } from '@dream-weave/canvas-core/generated';
import type { ICanvasInteractionService } from '@dream-weave/canvas-interaction';
import { AssetApi } from '../services/assets/asset-api.js';
import { createProjectAssetUploadService } from '../services/assets/project-asset-upload-service.js';
import { CanvasApi } from '../services/canvas/canvas-api.js';
import { createDreamWeaveNetworkClient } from '../services/network/create-network-client.js';

export interface ProjectCanvasApi {
  readonly canvas: CanvasApi;
  readonly assets: AssetApi;
}

export interface ProjectCanvasRuntime {
  readonly canvas: CanvasApi;
  readonly assets: AssetApi;
  readonly assetUpload: ICanvasAssetUploadService;
  readonly nodes: NodeRuntimeServices;
  createWebPreview(url: string, placement: Placement): Promise<void>;
}

/** Creates the app-wide HTTP adapters once; they own credentials and API error decoding. */
export function createProjectCanvasApi(): ProjectCanvasApi {
  const network = createDreamWeaveNetworkClient();
  return {
    canvas: new CanvasApi(createCanvasServiceClient(network.transport)),
    assets: new AssetApi(
      createAssetServiceClient(network.transport),
      createOfficeServiceClient(network.transport),
      network
    ),
  };
}

/** Application composition root: real browser services are assembled here, never via window globals. */
export function createProjectCanvasRuntime(options: {
  projectId: string;
  api: ProjectCanvasApi;
  document: ICanvasDocumentService;
  history: ICanvasHistoryService;
  interaction: ICanvasInteractionService;
  markdownEditorFrameUrl?: string;
}): ProjectCanvasRuntime {
  const { canvas, assets } = options.api;
  const preview = new HttpAssetPreviewService(options.projectId, assets);
  const download = new HttpAssetDownloadService(options.projectId, assets);
  const nodes: NodeRuntimeServices = {
    markdown: new CreativeNodeService(options.document, options.history),
    toolbar: new CanvasNodeToolbarService(options.document, options.history, download),
    preview,
    playback: new HttpAssetPlaybackService(options.projectId, assets),
    download,
    office: new HttpOfficeViewerSessionProvider(options.projectId, assets),
    markdownEditorFrameUrl: options.markdownEditorFrameUrl,
  };
  return {
    canvas,
    assets,
    nodes,
    assetUpload: createProjectAssetUploadService({ ...options, assets }),
    async createWebPreview(url, placement) {
      const asset = await assets.createWebAsset(options.projectId, url, new URL(url).hostname);
      const now = new Date().toISOString();
      options.history.execute({
        id: crypto.randomUUID(), projectId: options.projectId, createdAt: now, actor: 'user', type: 'create-item',
        item: { id: placement.itemId, kind: 'web-preview', title: asset.displayName, summary: url, assetId: asset.id, url, embeddable: true, createdAt: now, updatedAt: now },
        placement,
      });
      await options.document.flush();
    },
  };
}
