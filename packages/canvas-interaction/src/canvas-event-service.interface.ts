import type { BrandedService } from '@dream-weave/di';
import { createDecorator } from '@dream-weave/di';
import { Signal } from '@dream-weave/canvas-core';
import type { ItemId } from '@dream-weave/canvas-core';

/** One-shot requests emitted by future toolbar and annotation packages. */
export type CanvasEventRequest =
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'zoom-to'; zoom: number }
  | { type: 'fit-view' }
  | { type: 'center-on-point'; point: { x: number; y: number } }
  | { type: 'focus-items'; itemIds: readonly ItemId[] }
  | { type: 'select-items'; itemIds: readonly ItemId[] }
  /** Reserves viewport space for a canvas-level side drawer without coupling the canvas to a panel implementation. */
  | { type: 'set-side-drawer'; side: 'right'; open: boolean; width: number }
  | { type: 'delete-selection' }
  | { type: 'set-tool-mode'; toolMode: CanvasToolMode };

/** Notifications intentionally exclude high-frequency pointer movement. */
export type CanvasEventNotification =
  | { type: 'viewport-changed'; viewport: CanvasViewport }
  | { type: 'selection-changed'; itemIds: readonly ItemId[] }
  | { type: 'node-drag-started'; itemIds: readonly ItemId[] }
  | { type: 'node-drag-ended'; itemIds: readonly ItemId[] }
  | { type: 'items-deleted'; itemIds: readonly ItemId[] };

/** `pointer` is the rectangular lasso; `freeform-lasso` is the line-lasso mode. */
export type CanvasToolMode = 'pointer' | 'hand' | 'freeform-lasso' | 'connection';

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ICanvasEventService extends BrandedService {
  readonly onDidRequest: Signal<CanvasEventRequest>;
  readonly onDidNotify: Signal<CanvasEventNotification>;
  request(event: CanvasEventRequest): void;
  notify(event: CanvasEventNotification): void;
  dispose(): void;
}

export const ICanvasEventService = createDecorator<ICanvasEventService>('dream-weave.canvas-event-service');
