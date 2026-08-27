import { Signal } from '../events/signal.js';

export interface AssetAccessResult { url: string; expiresAt: string; fileName?: string; }
export interface CreatedWebAsset { id: string; displayName: string; }
export interface OfficeSessionConfig { sessionId: string; documentServerUrl: string; documentUrl: string; documentKey: string; token: string; documentTitle: string; fileType: 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf'; documentType: 'word' | 'cell' | 'slide' | 'pdf'; expiresAt: string; }
/** Domain-facing boundary implemented by adapters around generated clients. */
export interface AssetRuntimeTransport { getPreviewAccess(projectId: string, assetId: string): Promise<AssetAccessResult>; getPlaybackAccess(projectId: string, assetId: string): Promise<AssetAccessResult>; getHtmlPreviewAccess(projectId: string, assetId: string): Promise<AssetAccessResult>; getDownloadAccess(projectId: string, assetId: string): Promise<AssetAccessResult>; createWebAsset(projectId: string, url: string, displayName: string): Promise<CreatedWebAsset>; createOfficeSession(projectId: string, assetId: string): Promise<OfficeSessionConfig>; }
export class HttpAssetPreviewService {
  constructor(private readonly projectId: string, private readonly transport: AssetRuntimeTransport) {}
  async getPreview(assetId: string): Promise<{ url: string; expiresAt: string }> { return this.transport.getPreviewAccess(this.projectId, assetId); }
  async getHtmlPreview(assetId: string): Promise<{ url: string; expiresAt: string }> { return this.transport.getHtmlPreviewAccess(this.projectId, assetId); }
}
export class HttpAssetPlaybackService {
  constructor(private readonly projectId: string, private readonly transport: AssetRuntimeTransport) {}
  getPlayback(assetId: string): Promise<{ url: string; expiresAt: string }> { return this.transport.getPlaybackAccess(this.projectId, assetId); }
}
export class HttpAssetWebCreationService {
  constructor(private readonly projectId: string, private readonly transport: AssetRuntimeTransport) {}
  create(url: string, displayName: string): Promise<CreatedWebAsset> { return this.transport.createWebAsset(this.projectId, url, displayName); }
}
export class HttpAssetDownloadService {
  constructor(private readonly projectId: string, private readonly transport: AssetRuntimeTransport) {}
  async download(assetId: string): Promise<void> { const access = await this.transport.getDownloadAccess(this.projectId, assetId); window.location.assign(access.url); }
}
export class HttpOfficeViewerSessionProvider {
  constructor(private readonly projectId: string, private readonly transport: AssetRuntimeTransport) {}
  getSession(assetId: string): Promise<OfficeSessionConfig> { return this.transport.createOfficeSession(this.projectId, assetId); }
}
export interface AssetUploadSnapshot { phase: 'idle' | 'uploading' | 'failed'; errorMessage: string | null; }
export interface ICanvasAssetUploadService { readonly onDidChange: Signal<AssetUploadSnapshot>; getSnapshot(): AssetUploadSnapshot; upload(files: readonly File[]): Promise<void>; }
/**
 * The toolbar passes opaque Files only. This adapter intentionally does not infer
 * asset kind in the browser. Its gateway is the generated server client.
 */
export class CanvasAssetUploadService implements ICanvasAssetUploadService {
  readonly onDidChange = new Signal<AssetUploadSnapshot>();
  private snapshot: AssetUploadSnapshot = { phase: 'idle', errorMessage: null };
  constructor(private readonly gateway: { upload(files: readonly File[]): Promise<void> }) {}
  getSnapshot(): AssetUploadSnapshot { return this.snapshot; }
  async upload(files: readonly File[]): Promise<void> { this.set({ phase: 'uploading', errorMessage: null }); try { await this.gateway.upload(files); this.set({ phase: 'idle', errorMessage: null }); } catch (error) { this.set({ phase: 'failed', errorMessage: error instanceof Error ? error.message : '上传失败，请重试。' }); } }
  private set(next: AssetUploadSnapshot): void { this.snapshot = next; this.onDidChange.emit(next); }
}
/** Fixed placement policy shared by markdown and Asset node creation after the server accepts input. */
export function createUploadPlacements(files: readonly { itemId: string; kind: keyof typeof DEFAULT_NODE_DIMENSIONS; markdown?: string }[], center: { x: number; y: number }, currentMaxZIndex: number) {
  return files.map((file, index) => {
    const [width, defaultHeight] = DEFAULT_NODE_DIMENSIONS[file.kind];
    const height = file.kind === 'markdown' ? estimateMarkdownPlacementHeight(file.markdown ?? '') : defaultHeight;
    return { itemId: file.itemId, x: center.x + 32 * index, y: center.y + 32 * index, width, height, zIndex: currentMaxZIndex + index + 1 };
  });
}
/**
 * Text cards have a fixed default width. Their height is automatically kept
 * within the Product Brief's readable range.
 */
export const MARKDOWN_NODE_RESIZE_BOUNDS = { minHeight: 100, maxHeight: 924.333 } as const;
export const DEFAULT_NODE_DIMENSIONS = { markdown: [550, MARKDOWN_NODE_RESIZE_BOUNDS.minHeight], image: [360, 360], audio: [640, 280], video: [640, 500], 'web-preview': [520, 360], html: [560, 400], pdf: [420, 560], office: [520, 360], frame: [760, 520] } as const;

/**
 * Uses the same 550px card, 64px horizontal editor padding, and 14/21 text
 * metrics as the readonly Markdown node. This makes imported .md/.txt files
 * open at their useful height before the sandboxed editor is ready.
 */
export function estimateMarkdownPlacementHeight(markdown: string): number {
  const availableLineWidth = DEFAULT_NODE_DIMENSIONS.markdown[0] - 16 - 128;
  const textLines = markdown.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const visualLines = Math.max(1, textLines.reduce((total, line) => total + Math.max(1, Math.ceil(estimateTextWidth(line) / availableLineWidth)), 0));
  const nodeChromeHeight = 32 + 4 + 8;
  const editorVerticalPadding = 32;
  return Math.min(MARKDOWN_NODE_RESIZE_BOUNDS.maxHeight, Math.max(MARKDOWN_NODE_RESIZE_BOUNDS.minHeight, Math.ceil(nodeChromeHeight + editorVerticalPadding + visualLines * 21)));
}

function estimateTextWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === '\t') width += 28;
    else if (/\s/.test(character)) width += 4;
    else if (/[\u2E80-\u9FFF\uF900-\uFAFF]/.test(character)) width += 14;
    else width += 7.2;
  }
  return width;
}
export function isMarkdownImport(fileName: string): boolean { return /\.(md|markdown|txt|text)$/i.test(fileName); }
export async function readMarkdownImport(file: File): Promise<string> { const text = await file.text(); return /\.(txt|text)$/i.test(file.name) ? text.split(/\r?\n/).map((line) => line.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1')).join('\n\n') : text; }
