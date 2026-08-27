import { applyCommand } from '../command/apply-command.js';
import { createEmptyDocument, documentFromSnapshot, documentToSnapshot, type CanvasDocumentSnapshot } from '../model/canvas-document.js';
import type { ProjectId } from '../model/ids.js';
import type { ApplyCommandsResult, ICanvasDocumentRepository } from './canvas-document-repository.interface.js';
import type { CanvasCommand } from '../command/canvas-command.js';

/** Test and local-development repository with the same revision semantics as the HTTP port. */
export class InMemoryCanvasDocumentRepository implements ICanvasDocumentRepository {
  readonly _serviceBrand: undefined = undefined;
  private readonly documents = new Map<ProjectId, CanvasDocumentSnapshot>();
  private disposed = false;

  constructor(initialSnapshots: readonly CanvasDocumentSnapshot[] = []) {
    for (const snapshot of initialSnapshots) this.documents.set(snapshot.projectId, structuredClone(snapshot));
  }

  public async load(projectId: ProjectId): Promise<CanvasDocumentSnapshot> {
    this.assertActive();
    return structuredClone(this.documents.get(projectId) ?? documentToSnapshot(createEmptyDocument(projectId)));
  }

  public async apply(projectId: ProjectId, expectedRevision: number, commands: readonly CanvasCommand[]): Promise<ApplyCommandsResult> {
    this.assertActive();
    const currentSnapshot = await this.load(projectId);
    if (currentSnapshot.revision !== expectedRevision) return { ok: false, kind: 'conflict', snapshot: currentSnapshot };
    let document = documentFromSnapshot(currentSnapshot);
    for (const command of commands) document = applyCommand(document, command);
    document.revision = currentSnapshot.revision + 1;
    const snapshot = documentToSnapshot(document);
    this.documents.set(projectId, structuredClone(snapshot));
    return { ok: true, snapshot, acceptedCommandIds: commands.map((command) => command.id) };
  }

  public dispose(): void {
    this.disposed = true;
    this.documents.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Canvas document repository is disposed.');
  }
}
