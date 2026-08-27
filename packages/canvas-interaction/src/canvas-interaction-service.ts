import { Signal } from '@dream-weave/canvas-core';
import type { ItemId } from '@dream-weave/canvas-core';
import type { CanvasToolMode, CanvasViewport } from './canvas-event-service.interface.js';
import type { CanvasInteractionSnapshot, ICanvasInteractionService } from './canvas-interaction-service.interface.js';

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

/** Workspace-scoped ephemeral state. It must never be written into CanvasDocument. */
export class CanvasInteractionService implements ICanvasInteractionService {
  readonly _serviceBrand: undefined = undefined;
  readonly onDidChange = new Signal<CanvasInteractionSnapshot>();
  readonly onDidRequestNodeResize = new Signal<{ itemId: ItemId; height: number }>();

  private selectedItemIds: ItemId[] = [];
  private viewport: CanvasViewport = DEFAULT_VIEWPORT;
  private isDragging = false;
  private toolMode: CanvasToolMode = 'pointer';
  private disposed = false;

  public getSnapshot(): CanvasInteractionSnapshot {
    this.assertActive();
    return this.snapshot();
  }

  public setSelectedItemIds(itemIds: readonly ItemId[]): void {
    this.assertActive();
    const next = [...new Set(itemIds)];
    if (sameItemIds(this.selectedItemIds, next)) return;
    this.selectedItemIds = next;
    this.emit();
  }

  public setViewport(viewport: CanvasViewport): void {
    this.assertActive();
    if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom)) return;
    if (sameViewport(this.viewport, viewport)) return;
    this.viewport = { ...viewport };
    this.emit();
  }

  public setDragging(isDragging: boolean): void {
    this.assertActive();
    if (this.isDragging === isDragging) return;
    this.isDragging = isDragging;
    this.emit();
  }

  public setToolMode(toolMode: CanvasToolMode): void {
    this.assertActive();
    if (this.toolMode === toolMode) return;
    this.toolMode = toolMode;
    this.emit();
  }

  public requestNodeResize({ itemId, height }: { itemId: ItemId; height: number }): void {
    this.assertActive();
    if (!Number.isFinite(height) || height <= 0) return;
    this.onDidRequestNodeResize.emit({ itemId, height });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selectedItemIds = [];
    this.onDidChange.clear();
    this.onDidRequestNodeResize.clear();
  }

  private snapshot(): CanvasInteractionSnapshot {
    return {
      selectedItemIds: [...this.selectedItemIds],
      viewport: { ...this.viewport },
      isDragging: this.isDragging,
      toolMode: this.toolMode,
    };
  }

  private emit(): void {
    this.onDidChange.emit(this.snapshot());
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Canvas interaction service is disposed.');
  }
}

function sameItemIds(left: readonly ItemId[], right: readonly ItemId[]): boolean {
  return left.length === right.length && left.every((itemId, index) => itemId === right[index]);
}

function sameViewport(left: CanvasViewport, right: CanvasViewport): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}
