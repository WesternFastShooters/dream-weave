import type { BrandedService } from '@dream-weave/di';
import { createDecorator } from '@dream-weave/di';
import type { CanvasCommand } from '../command/canvas-command.js';
import { Signal } from '../events/signal.js';
import type { CanvasDocument } from '../model/canvas-document.js';

export interface CanvasDocumentChange { document: CanvasDocument; command: CanvasCommand | null; reason: 'initialized' | 'optimistic-command' | 'reconciled'; }
export interface CanvasDocumentConflict { droppedCommandIds: string[]; }
export interface CanvasPersistError { error: unknown; commandIds: string[]; }

export interface ICanvasDocumentService extends BrandedService {
  readonly onDidChange: Signal<CanvasDocumentChange>;
  readonly onDidConflict: Signal<CanvasDocumentConflict>;
  readonly onDidPersistError: Signal<CanvasPersistError>;
  initialize(): Promise<CanvasDocument>;
  getDocument(): CanvasDocument;
  execute(command: CanvasCommand): CanvasCommand[];
  executeBatch(commands: readonly CanvasCommand[]): CanvasCommand[];
  flush(): Promise<void>;
  /** Drops optimistic commands after a terminal persistence rejection and reloads the server snapshot. */
  discardPendingAndReload(): Promise<void>;
  dispose(): void;
}

export const ICanvasDocumentService = createDecorator<ICanvasDocumentService>('dream-weave.canvas-document-service');
