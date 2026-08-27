import { ICanvasDocumentService, type ICanvasDocumentService as ICanvasDocumentServiceType } from './canvas-document-service.interface.js';
import { Signal, type Disposable } from '../events/signal.js';
import type { PublicCanvasCommand } from '../command/canvas-command.js';
import type { CanvasHistoryChange, HistoryEntry, ICanvasHistoryService } from './canvas-history-service.interface.js';

export class CanvasHistoryService implements ICanvasHistoryService {
  readonly _serviceBrand: undefined = undefined;
  readonly onDidChange = new Signal<CanvasHistoryChange>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly conflictSubscription: Disposable;
  private disposed = false;

  constructor(@ICanvasDocumentService private readonly documentService: ICanvasDocumentServiceType) {
    this.conflictSubscription = documentService.onDidConflict.subscribe(() => this.invalidateForConflict());
  }

  public execute(command: PublicCanvasCommand, groupId?: string): void { this.executeBatch([command], groupId); }

  public executeBatch(commands: readonly PublicCanvasCommand[], groupId?: string): void {
    this.assertActive();
    if (commands.length === 0) throw new Error('Canvas history batches must contain at least one command.');
    const forward = commands.map((command) => structuredClone(command));
    const inverse = this.documentService.executeBatch(forward);
    if (forward.every((command) => command.actor === 'system')) return;
    const last = this.undoStack.at(-1);
    const canCoalesce = groupId && last?.groupId === groupId
      && forward.length === 1 && last.forward.length === 1
      && forward[0]?.type === 'set-placements' && last.forward[0]?.type === 'set-placements';
    if (canCoalesce) {
      last.forward = forward;
    } else {
      this.undoStack.push({ forward, inverse, groupId });
    }
    this.redoStack = [];
    this.emitChange();
  }

  public undo(): boolean {
    this.assertActive();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.documentService.executeBatch(entry.inverse);
    this.redoStack.push(entry);
    this.emitChange();
    return true;
  }

  public redo(): boolean {
    this.assertActive();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.documentService.executeBatch(entry.forward);
    this.undoStack.push(entry);
    this.emitChange();
    return true;
  }

  public canUndo(): boolean { return this.undoStack.length > 0; }
  public canRedo(): boolean { return this.redoStack.length > 0; }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.conflictSubscription.dispose();
    this.undoStack = [];
    this.redoStack = [];
    this.onDidChange.clear();
  }

  /** Rejected optimistic commands cannot be undone or redone against the server snapshot. */
  private invalidateForConflict(): void {
    if (this.disposed) return;
    this.undoStack = [];
    this.redoStack = [];
    this.emitChange();
  }

  private emitChange(): void { this.onDidChange.emit({ canUndo: this.canUndo(), canRedo: this.canRedo() }); }
  private assertActive(): void { if (this.disposed) throw new Error('Canvas history service is disposed.'); }
}
