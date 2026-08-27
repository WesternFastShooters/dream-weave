import {
  CanvasAssetUploadService,
  createUploadPlacements,
  isMarkdownImport,
  readMarkdownImport,
  type CanvasItem,
  type ICanvasDocumentService,
  type ICanvasHistoryService,
} from '@dream-weave/canvas-core';
import type { ICanvasInteractionService } from '@dream-weave/canvas-interaction';
import type { AssetApi, UploadedAsset } from './asset-api.js';

/** Coordinates browser files with the Asset API and the project document. */
export function createProjectAssetUploadService(options: {
  projectId: string;
  assets: Pick<AssetApi, 'upload'>;
  document: ICanvasDocumentService;
  history: ICanvasHistoryService;
  interaction: ICanvasInteractionService;
}): CanvasAssetUploadService {
  return new CanvasAssetUploadService({
    upload: async (files) => {
      const document = options.document.getDocument();
      const viewport = options.interaction.getSnapshot().viewport;
      const center = { x: -viewport.x / viewport.zoom + 400 / viewport.zoom, y: -viewport.y / viewport.zoom + 300 / viewport.zoom };
      const now = new Date().toISOString();
      const itemInputs = await Promise.all(files.map(async (file) => ({
        item: isMarkdownImport(file.name)
          ? markdownItem(file, await readMarkdownImport(file), now)
          : assetItem(file, await options.assets.upload(options.projectId, file), now),
      })));
      const maxZIndex = Math.max(-1, ...[...document.placements.values()].map((placement) => placement.zIndex));
      const placements = createUploadPlacements(itemInputs.map(({ item }) => ({
        itemId: item.id,
        kind: item.kind,
        markdown: item.kind === 'markdown' ? item.markdown : undefined,
      })), center, maxZIndex);
      options.history.executeBatch(itemInputs.map(({ item }, index) => ({
        id: crypto.randomUUID(), projectId: options.projectId, createdAt: now, actor: 'user' as const, type: 'create-item' as const, item, placement: placements[index]!,
      })));
      try {
        await options.document.flush();
      } catch (error) {
        if (isTerminalPersistenceError(error)) {
          try { await options.document.discardPendingAndReload(); } catch { /* keep the original persistence error */ }
        }
        throw error;
      }
    },
  });
}

function markdownItem(file: File, markdown: string, now: string): CanvasItem {
  return { id: crypto.randomUUID(), kind: 'markdown', title: file.name, summary: '', markdown, createdAt: now, updatedAt: now };
}

function assetItem(file: File, asset: UploadedAsset, now: string): CanvasItem {
  const base = { id: crypto.randomUUID(), title: asset.displayName, summary: '', assetId: asset.id, createdAt: now, updatedAt: now };
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (asset.kind) {
    case 'image': return { ...base, kind: 'image', previewAvailable: asset.processingState === 'ready', format: extension };
    case 'audio': return { ...base, kind: 'audio', format: audioFormat(extension), durationMs: 0, waveform: Array(64).fill(0), sceneLabel: '' };
    case 'video': return { ...base, kind: 'video', posterAvailable: false, durationMs: 0, shotLabel: '' };
    case 'html': return { ...base, kind: 'html', previewAvailable: asset.processingState === 'ready' };
    case 'pdf': return { ...base, kind: 'pdf', previewAvailable: asset.processingState === 'ready' };
    case 'office': return { ...base, kind: 'office', officeKind: officeKind(extension), fileType: officeFormat(extension), previewAvailable: asset.processingState === 'ready' };
  }
}

function audioFormat(extension: string): 'wav' | 'mp3' | 'm4a' | 'ogg' {
  return extension === 'wav' || extension === 'mp3' || extension === 'm4a' || extension === 'ogg' ? extension : 'mp3';
}
function officeFormat(extension: string): 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' {
  return extension === 'doc' || extension === 'docx' || extension === 'xls' || extension === 'xlsx' || extension === 'ppt' || extension === 'pptx' ? extension : 'docx';
}
function officeKind(extension: string): 'word' | 'spreadsheet' | 'presentation' {
  return extension === 'xls' || extension === 'xlsx' ? 'spreadsheet' : extension === 'ppt' || extension === 'pptx' ? 'presentation' : 'word';
}

function isTerminalPersistenceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 425 && status !== 429;
}
