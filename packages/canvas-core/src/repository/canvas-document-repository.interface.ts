import type { BrandedService } from '@dream-weave/di';
import { createDecorator } from '@dream-weave/di';
import type { CanvasCommand } from '../command/canvas-command.js';
import type { CanvasDocumentSnapshot } from '../model/canvas-document.js';
import type { ProjectId } from '../model/ids.js';

export type ApplyCommandsResult =
  | { ok: true; snapshot: CanvasDocumentSnapshot; acceptedCommandIds: string[] }
  | { ok: false; kind: 'conflict'; snapshot: CanvasDocumentSnapshot };

export interface ICanvasDocumentRepository extends BrandedService {
  load(projectId: ProjectId): Promise<CanvasDocumentSnapshot>;
  apply(projectId: ProjectId, expectedRevision: number, commands: readonly CanvasCommand[]): Promise<ApplyCommandsResult>;
  dispose(): void;
}

export const ICanvasDocumentRepository = createDecorator<ICanvasDocumentRepository>('dream-weave.canvas-document-repository');
