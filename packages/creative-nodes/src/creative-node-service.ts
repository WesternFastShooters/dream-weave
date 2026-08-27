import { type CanvasItem, type ICanvasDocumentService as DocumentService, type ICanvasHistoryService as HistoryService } from '@dream-weave/canvas-core';
import type { IAssetDownloadService, ICanvasNodeToolbarService, ICreativeNodeService, NodeToolbarAction, NodeToolbarActionId } from './types.js';

export class CreativeNodeService implements ICreativeNodeService {
  constructor(private readonly documentService: DocumentService, private readonly history: HistoryService) {}
  updateMarkdown(item: Extract<CanvasItem, { kind: 'markdown' }>, markdown: string): void {
    if (markdown === item.markdown) return;
    const updatedAt = new Date().toISOString();
    this.history.execute({ id: crypto.randomUUID(), projectId: this.documentService.getDocument().projectId, createdAt: updatedAt, actor: 'user', type: 'update-item', item: { ...item, markdown, summary: markdownSummary(markdown), updatedAt } });
  }
}

/** Toolbar mutations use only history commands; access URLs are never retained. */
export class CanvasNodeToolbarService implements ICanvasNodeToolbarService {
  private readonly busy = new Set<string>();
  constructor(
    private readonly documentService: DocumentService,
    private readonly history: HistoryService,
    private readonly downloadService: IAssetDownloadService | undefined,
    private readonly toast: (message: string) => void = () => undefined,
  ) {}
  getActions(item: CanvasItem): readonly NodeToolbarAction[] {
    const base: NodeToolbarAction[] = [{ id: 'duplicate', label: '复制一份', icon: 'duplicate' }];
    if (item.kind === 'markdown') base.push({ id: 'export-markdown', label: '导出 Markdown', icon: 'download' });
    else if (item.kind !== 'frame' && item.kind !== 'web-preview' && this.downloadService) base.push({ id: 'download', label: '下载', icon: 'download' });
    base.push({ id: 'delete', label: '删除', icon: 'trash' }); return base;
  }
  async execute(actionId: NodeToolbarActionId, itemId: string): Promise<string | undefined> {
    if (this.busy.has(itemId)) return; const document = this.documentService.getDocument(); const item = document.items.get(itemId); if (!item) return; this.busy.add(itemId);
    try {
      let mutatesCanvas = false;
      let createdItemId: string | undefined;
      if (actionId === 'duplicate') { const placement = document.placements.get(itemId); if (!placement) throw new Error('节点缺少布局。'); const now = new Date().toISOString(); const copyId = crypto.randomUUID(); this.history.execute({ id: crypto.randomUUID(), projectId: document.projectId, createdAt: now, actor: 'user', type: 'create-item', item: { ...structuredClone(item), id: copyId, createdAt: now, updatedAt: now }, placement: { ...placement, itemId: copyId, x: placement.x + 32, y: placement.y + 32, zIndex: Math.max(-1, ...[...document.placements.values()].map((value) => value.zIndex)) + 1 } }); createdItemId = copyId; mutatesCanvas = true; }
      else if (actionId === 'delete') { this.history.execute({ id: crypto.randomUUID(), projectId: document.projectId, createdAt: new Date().toISOString(), actor: 'user', type: 'delete-item', itemId }); mutatesCanvas = true; }
      else if (actionId === 'export-markdown' && item.kind === 'markdown') exportMarkdown(item.title, item.markdown);
      else if (actionId === 'download' && 'assetId' in item && this.downloadService) await this.downloadService.download(item.assetId);
      if (mutatesCanvas) await this.documentService.flush();
      return createdItemId;
    } catch (error) {
      try { await this.documentService.discardPendingAndReload(); } catch { /* preserve the original failure */ }
      const message = error instanceof Error ? error.message : '操作失败，请重试。';
      this.toast(message);
      throw error;
    } finally { this.busy.delete(itemId); }
  }
}
export function markdownSummary(markdown: string): string { return markdown.replace(/[`*_>#\[\]()!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160); }
function exportMarkdown(title: string, markdown: string): void { const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || 'untitled'}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
