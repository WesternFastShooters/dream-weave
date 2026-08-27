import type { ICanvasDocumentRepository as ICanvasDocumentRepositoryType } from '../repository/canvas-document-repository.interface.js';
import { ICanvasDocumentRepository } from '../repository/canvas-document-repository.interface.js';
import { applyCommand } from '../command/apply-command.js';
import { invertCommand } from '../command/invert-command.js';
import { cloneDocument, createEmptyDocument, documentFromSnapshot, type CanvasDocument } from '../model/canvas-document.js';
import type { ProjectId } from '../model/ids.js';
import type { CanvasCommand } from '../command/canvas-command.js';
import { Signal } from '../events/signal.js';
import type { CanvasDocumentChange, CanvasDocumentConflict, CanvasPersistError, ICanvasDocumentService } from './canvas-document-service.interface.js';

const PLACEMENT_FLUSH_DELAY_MS = 120;

export class CanvasDocumentService implements ICanvasDocumentService {
  readonly _serviceBrand: undefined = undefined;
  readonly onDidChange = new Signal<CanvasDocumentChange>();
  readonly onDidConflict = new Signal<CanvasDocumentConflict>();
  readonly onDidPersistError = new Signal<CanvasPersistError>();

  private document: CanvasDocument | null = null;
  private pendingCommands: CanvasCommand[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly projectId: ProjectId,
    @ICanvasDocumentRepository private readonly repository: ICanvasDocumentRepositoryType
  ) {}

  public async initialize(): Promise<CanvasDocument> {
    this.assertActive();
    const snapshot = await this.repository.load(this.projectId);
    if (snapshot.projectId !== this.projectId) throw new Error('Repository returned a document for a different project.');
    this.document = documentFromSnapshot(snapshot);
    this.onDidChange.emit({ document: cloneDocument(this.document), command: null, reason: 'initialized' });
    return cloneDocument(this.document);
  }

  public getDocument(): CanvasDocument {
    this.assertActive();
    return cloneDocument(this.requireDocument());
  }

  /** Applies a fully validated batch locally and returns its inverse in reverse order. */
  public execute(command: CanvasCommand): CanvasCommand[] {
    return this.executeBatch([command]);
  }

  public executeBatch(commands: readonly CanvasCommand[]): CanvasCommand[] {
    this.assertActive();
    if (commands.length === 0) throw new Error('Canvas command batches must contain at least one command.');
    let next = this.requireDocument();
    const inverses: CanvasCommand[] = [];
    for (const command of commands) {
      const before = next;
      const inverse = invertCommand(before, command);
      next = applyCommand(before, command);
      inverses.unshift(...inverse);
    }
    this.document = next;
    this.pendingCommands.push(...commands.map((command) => structuredClone(command)));
    this.onDidChange.emit({ document: cloneDocument(next), command: structuredClone(commands.at(-1)!), reason: 'optimistic-command' });
    if (commands.every((command) => command.type === 'set-placements')) this.schedulePlacementFlush();
    else void this.flush().catch(() => undefined);
    return inverses;
  }

  public async flush(): Promise<void> {
    this.assertActive();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushPending().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  public async discardPendingAndReload(): Promise<void> {
    this.assertActive();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPromise) {
      try { await this.flushPromise; } catch { /* the terminal error is reported by the caller */ }
    }
    const snapshot = await this.repository.load(this.projectId);
    if (snapshot.projectId !== this.projectId) throw new Error('Repository returned a document for a different project.');
    const droppedCommandIds = this.pendingCommands.map((command) => command.id);
    this.pendingCommands = [];
    this.document = documentFromSnapshot(snapshot);
    if (droppedCommandIds.length > 0) this.onDidConflict.emit({ droppedCommandIds });
    this.onDidChange.emit({ document: cloneDocument(this.document), command: null, reason: 'reconciled' });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.onDidChange.clear();
    this.onDidConflict.clear();
    this.onDidPersistError.clear();
  }

  private async flushPending(): Promise<void> {
    while (this.pendingCommands.length > 0) {
      const batch = this.takePendingBatch();
      const document = this.requireDocument();
      try {
        const result = await this.repository.apply(this.projectId, document.revision, batch);
        if (!result.ok) {
          const droppedCommandIds = [...batch, ...this.pendingCommands].map((command) => command.id);
          this.pendingCommands = [];
          this.document = documentFromSnapshot(result.snapshot);
          this.onDidConflict.emit({ droppedCommandIds });
          this.onDidChange.emit({ document: cloneDocument(this.document), command: null, reason: 'reconciled' });
          return;
        }
        this.reconcileServerSnapshot(result.snapshot, this.pendingCommands);
      } catch (error) {
        this.pendingCommands.unshift(...batch);
        this.onDidPersistError.emit({ error, commandIds: batch.map((command) => command.id) });
        throw error;
      }
    }
  }

  private takePendingBatch(): CanvasCommand[] {
    const commands = this.pendingCommands.splice(0);
    const result: CanvasCommand[] = [];
    for (let index = 0; index < commands.length; ) {
      const command = commands[index]!;
      if (command.type !== 'set-placements') {
        result.push(command);
        index++;
        continue;
      }
      const firstPlacementCommand = command;
      const latestPlacementByItem = new Map<string, (typeof command.placements)[number]>();
      while (index < commands.length && commands[index]?.type === 'set-placements') {
        const placementCommand = commands[index]!;
        if (placementCommand.type === 'set-placements') {
          for (const placement of placementCommand.placements) {
            latestPlacementByItem.set(placement.itemId, structuredClone(placement));
          }
        }
        index++;
      }
      result.push({ ...firstPlacementCommand, placements: [...latestPlacementByItem.values()] });
    }
    return result;
  }

  private reconcileServerSnapshot(snapshot: Parameters<typeof documentFromSnapshot>[0], commandsToReplay: readonly CanvasCommand[]): void {
    let next = documentFromSnapshot(snapshot);
    const replayable: CanvasCommand[] = [];
    const dropped: string[] = [];
    for (const command of commandsToReplay) {
      try {
        next = applyCommand(next, command);
        replayable.push(command);
      } catch {
        dropped.push(command.id);
      }
    }
    this.document = next;
    this.pendingCommands = replayable;
    if (dropped.length > 0) this.onDidConflict.emit({ droppedCommandIds: dropped });
    this.onDidChange.emit({ document: cloneDocument(next), command: null, reason: 'reconciled' });
  }


  private schedulePlacementFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => undefined);
    }, PLACEMENT_FLUSH_DELAY_MS);
  }

  private requireDocument(): CanvasDocument {
    if (!this.document) throw new Error('Canvas document service is not initialized.');
    return this.document;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Canvas document service is disposed.');
  }
}
