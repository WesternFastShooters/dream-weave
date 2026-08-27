import type { CanvasItem, ItemId, Placement } from '@dream-weave/canvas-core';

export type NodeToolbarActionId = 'duplicate' | 'download' | 'export-markdown' | 'delete';
export interface NodeToolbarAction { id: NodeToolbarActionId; label: string; icon: 'duplicate' | 'download' | 'trash'; }
export interface AssetAccess { url: string; expiresAt: string; }
export interface IAssetPreviewService { getPreview(assetId: string): Promise<AssetAccess>; getHtmlPreview(assetId: string): Promise<AssetAccess>; }
export interface IAssetDownloadService { download(assetId: string): Promise<void>; }
export interface IAssetPlaybackService { getPlayback(assetId: string): Promise<AssetAccess>; }
export interface OfficeViewerSessionRuntimeConfig {
  sessionId: string; documentServerUrl: string; documentUrl: string; documentKey: string; token: string;
  documentTitle: string; fileType: 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf';
  documentType: 'word' | 'cell' | 'slide' | 'pdf'; expiresAt: string;
}
export interface IOfficeViewerSessionProvider { getSession(assetId: string): Promise<OfficeViewerSessionRuntimeConfig>; }
export interface ICanvasNodeToolbarService {
  getActions(item: CanvasItem): readonly NodeToolbarAction[];
  /** Returns the created item ID for actions that add a node. */
  execute(actionId: NodeToolbarActionId, itemId: ItemId): Promise<ItemId | undefined>;
}
export interface NodeRuntimeServices {
  preview?: IAssetPreviewService; playback?: IAssetPlaybackService; download?: IAssetDownloadService; office?: IOfficeViewerSessionProvider;
  markdown?: ICreativeNodeService; toolbar?: ICanvasNodeToolbarService; onToast?: (message: string) => void;
  /** Dedicated, sandboxed document used by Markdown nodes to host Crepe. */
  markdownEditorFrameUrl?: string;
}
export interface ICreativeNodeService { updateMarkdown(item: Extract<CanvasItem, { kind: 'markdown' }>, markdown: string): void; }
export const DEFAULT_NODE_SIZES = {
  markdown: [550, 100], image: [280, 280], audio: [640, 280], video: [640, 500], 'web-preview': [520, 360], html: [550, 924.333], pdf: [420, 560], office: [520, 360], frame: [760, 520],
} as const;
export type NodeDefaultSizeKind = keyof typeof DEFAULT_NODE_SIZES;
export function defaultPlacement(itemId: string, kind: NodeDefaultSizeKind, x: number, y: number, zIndex: number): Placement {
  const [width, height] = DEFAULT_NODE_SIZES[kind];
  return { itemId, x, y, width, height, zIndex };
}
