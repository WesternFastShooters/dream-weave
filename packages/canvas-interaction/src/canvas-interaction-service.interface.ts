import type { BrandedService } from '@dream-weave/di';
import { createDecorator } from '@dream-weave/di';
import { Signal } from '@dream-weave/canvas-core';
import type { ItemId } from '@dream-weave/canvas-core';
import type { CanvasToolMode, CanvasViewport } from './canvas-event-service.interface.js';

export interface CanvasInteractionSnapshot {
  selectedItemIds: readonly ItemId[];
  viewport: CanvasViewport;
  isDragging: boolean;
  toolMode: CanvasToolMode;
}

export interface CanvasNodeResizeRequest { itemId: ItemId; height: number; }

export interface ICanvasInteractionService extends BrandedService {
  readonly onDidChange: Signal<CanvasInteractionSnapshot>;
  /** Ephemeral node-size updates used while an editor is active. */
  readonly onDidRequestNodeResize?: Signal<CanvasNodeResizeRequest>;
  getSnapshot(): CanvasInteractionSnapshot;
  setSelectedItemIds(itemIds: readonly ItemId[]): void;
  setViewport(viewport: CanvasViewport): void;
  setDragging(isDragging: boolean): void;
  setToolMode(toolMode: CanvasToolMode): void;
  requestNodeResize?(request: CanvasNodeResizeRequest): void;
  dispose(): void;
}

export const ICanvasInteractionService = createDecorator<ICanvasInteractionService>('dream-weave.canvas-interaction-service');
