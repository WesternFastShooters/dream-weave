import type { BrandedService } from '@dream-weave/di';
import { createDecorator } from '@dream-weave/di';
import { Signal } from '../events/signal.js';
import type { PublicCanvasCommand } from '../command/canvas-command.js';

export interface CanvasHistoryChange { canUndo: boolean; canRedo: boolean; }

export interface ICanvasHistoryService extends BrandedService {
  readonly onDidChange: Signal<CanvasHistoryChange>;
  execute(command: PublicCanvasCommand, groupId?: string): void;
  executeBatch(commands: readonly PublicCanvasCommand[], groupId?: string): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  dispose(): void;
}

export const ICanvasHistoryService = createDecorator<ICanvasHistoryService>('dream-weave.canvas-history-service');

/** A history step is atomic even when its server mutation contains multiple commands. */
export interface HistoryEntry {
  forward: PublicCanvasCommand[];
  inverse: PublicCanvasCommand[];
  groupId: string | undefined;
}
