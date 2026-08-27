import type { CanvasCommand } from '../command/canvas-command.js';
import type { CanvasDocumentSnapshot as DomainCanvasDocumentSnapshot } from '../model/canvas-document.js';
import type { CanvasItem } from '../model/canvas-item.js';
import type { Placement } from '../model/placement.js';
import type { CanvasConnection } from '../model/canvas-connection.js';
import type { ApplyCommandsResult, ICanvasDocumentRepository } from '../repository/canvas-document-repository.interface.js';
import { adaptCanvasCommands, type ApplyCanvasMutationsRequestDto } from './canvas-command-adapter.js';
import type {
  CanvasDocumentSnapshot as GeneratedCanvasDocumentSnapshot,
  CanvasNodeSnapshot as GeneratedCanvasNodeSnapshot,
  Placement as GeneratedPlacement,
  CanvasConnection as GeneratedCanvasConnection,
} from './generated/dreamweave/v1/index.js';

export interface CanvasHttpTransport {
  getCanvas(projectId: string): Promise<GeneratedCanvasDocumentSnapshot>;
  applyCanvasCommands(request: ApplyCanvasMutationsRequestDto): Promise<GeneratedCanvasDocumentSnapshot>;
}
export type CanvasSnapshotDto = GeneratedCanvasDocumentSnapshot;
export type PlacementDto = GeneratedPlacement;
export type CanvasNodeSnapshotDto = GeneratedCanvasNodeSnapshot;
export interface CanvasRevisionConflictError { readonly code: 'CANVAS_REVISION_CONFLICT'; readonly currentRevision?: string; }
export function isCanvasRevisionConflict(error: unknown): error is CanvasRevisionConflictError { return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'CANVAS_REVISION_CONFLICT'); }

/** HTTP-facing repository. Generated API clients implement CanvasHttpTransport; credentials remain transport-owned. */
export class HttpCanvasDocumentRepository implements ICanvasDocumentRepository {
  readonly _serviceBrand: undefined = undefined;
  constructor(private readonly transport: CanvasHttpTransport) {}
  async load(projectId: string): Promise<DomainCanvasDocumentSnapshot> { return fromDto(await this.transport.getCanvas(projectId)); }
  async apply(projectId: string, expectedRevision: number, commands: readonly CanvasCommand[]): Promise<ApplyCommandsResult> {
    try { const snapshot = fromDto(await this.transport.applyCanvasCommands(adaptCanvasCommands(projectId, expectedRevision, commands))); return { ok: true, snapshot, acceptedCommandIds: commands.map((command) => command.id) }; }
    catch (error) { if (!isCanvasRevisionConflict(error)) throw error; return { ok: false, kind: 'conflict', snapshot: await this.load(projectId) }; }
  }
  dispose(): void { /* the generated client owns its connection lifetime */ }
}
export function fromDto(dto: CanvasSnapshotDto): DomainCanvasDocumentSnapshot {
  const revision = Number(requiredText(dto, 'revision')); if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Canvas API returned an invalid revision.');
  return {
    projectId: requiredString(dto, 'projectId'),
    revision,
    items: requiredArray(dto.nodes, 'nodes').map(nodeFromDto),
    placements: requiredArray(dto.placements, 'placements').map(placementFromDto),
    connections: requiredArray(dto.connections, 'connections').map(connectionFromDto),
  };
}
function connectionFromDto(value: GeneratedCanvasConnection): CanvasConnection {
  return {
    id: requiredString(value, 'id'),
    sourceItemId: optionalString(value, 'sourceNodeId'),
    sourceHandle: optionalOneOf(value, 'sourceHandle', ['top', 'right', 'bottom', 'left'] as const),
    sourceX: requiredNumber(value, 'sourceX'), sourceY: requiredNumber(value, 'sourceY'),
    targetItemId: optionalString(value, 'targetNodeId'),
    targetHandle: optionalOneOf(value, 'targetHandle', ['top', 'right', 'bottom', 'left'] as const),
    targetX: requiredNumber(value, 'targetX'), targetY: requiredNumber(value, 'targetY'),
    shape: requiredOneOf(value, 'shape', ['straight', 'curve', 'elbow'] as const),
    stroke: requiredOneOf(value, 'stroke', ['solid', 'dashed'] as const),
    direction: requiredOneOf(value, 'direction', ['none', 'forward', 'both'] as const),
  };
}
function placementFromDto(value: PlacementDto): Placement {
  return {
    itemId: requiredString(value, 'nodeId'), x: requiredNumber(value, 'x'), y: requiredNumber(value, 'y'),
    width: requiredNumber(value, 'width'), height: requiredNumber(value, 'height'), zIndex: requiredInteger(value, 'zIndex'),
  };
}
function nodeFromDto(node: CanvasNodeSnapshotDto): CanvasItem {
  const kind = requiredNodeKind(node.kind);
  const base = {
    id: requiredString(node, 'id'), kind, title: requiredText(node, 'title'), summary: requiredText(node, 'summary'),
    createdAt: requiredString(node, 'createdAt'), updatedAt: requiredString(node, 'updatedAt'),
  } as const;
  const render = node.renderData;
  if (!render) throw new Error('Canvas API returned invalid renderData.');
  if (kind === 'markdown') return { ...base, kind, markdown: requiredText(requiredObject(render.markdown, 'markdown'), 'markdown') };
  const assetId = () => requiredString(node, 'assetId');
  switch (kind) {
    case 'image': {
      const data = requiredObject(render.image, 'image');
      return { ...base, kind, assetId: assetId(), previewAvailable: requiredBoolean(data, 'previewAvailable'), format: requiredString(data, 'format') };
    }
    case 'audio': {
      const data = requiredObject(render.audio, 'audio');
      return { ...base, kind, assetId: assetId(), format: requiredString(data, 'format'), durationMs: requiredNonNegativeInteger(data, 'durationMs'), waveform: requiredWaveform(data), sceneLabel: requiredText(data, 'sceneLabel') };
    }
    case 'video': {
      const data = requiredObject(render.video, 'video');
      return { ...base, kind, assetId: assetId(), posterAvailable: requiredBoolean(data, 'posterAvailable'), durationMs: requiredNonNegativeInteger(data, 'durationMs'), shotLabel: requiredText(data, 'shotLabel') };
    }
    case 'web-preview': {
      const data = requiredObject(render.webPreview, 'webPreview');
      return { ...base, kind, assetId: assetId(), url: requiredHttps(data, 'url'), embeddable: requiredBoolean(data, 'embeddable') };
    }
    case 'html': {
      const data = requiredObject(render.html, 'html');
      return { ...base, kind, assetId: assetId(), previewAvailable: requiredBoolean(data, 'previewAvailable') };
    }
    case 'pdf': {
      const data = requiredObject(render.pdf, 'pdf');
      return { ...base, kind, assetId: assetId(), previewAvailable: requiredBoolean(data, 'previewAvailable') };
    }
    case 'office': {
      const data = requiredObject(render.office, 'office');
      return { ...base, kind, assetId: assetId(), officeKind: requiredOneOf(data, 'officeKind', ['word', 'spreadsheet', 'presentation'] as const), fileType: requiredOneOf(data, 'fileType', ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const), previewAvailable: requiredBoolean(data, 'previewAvailable') };
    }
    case 'frame': {
      const data = requiredObject(render.frame, 'frame');
      return { ...base, kind, description: requiredText(data, 'description'), color: requiredString(data, 'color') };
    }
  }
}
const NODE_KINDS = ['markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame'] as const;
function requiredNodeKind(value: unknown): CanvasItem['kind'] { if (typeof value === 'string' && (NODE_KINDS as readonly string[]).includes(value)) return value as CanvasItem['kind']; throw new Error('Canvas API returned invalid kind.'); }
function requiredObject<T extends object>(value: T | undefined, field: string): T { if (!value) throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredArray<T>(value: T[] | undefined, field: string): T[] { if (!Array.isArray(value)) throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredText(data: object, field: string): string { const value = (data as Record<string, unknown>)[field]; if (typeof value !== 'string') throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredString(data: object, field: string): string { const value = requiredText(data, field); if (!value) throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function optionalString(data: object, field: string): string | undefined { const value = (data as Record<string, unknown>)[field]; return typeof value === 'string' && value ? value : undefined; }
function requiredNumber(data: object, field: string): number { const value = (data as Record<string, unknown>)[field]; if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredInteger(data: object, field: string): number { const value = requiredNumber(data, field); if (!Number.isInteger(value)) throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredBoolean(data: object, field: string): boolean { const value = (data as Record<string, unknown>)[field]; if (typeof value !== 'boolean') throw new Error(`Canvas API returned invalid ${field}.`); return value; }
function requiredNonNegativeInteger(data: object, field: string): number { const raw = (data as Record<string, unknown>)[field]; const value = typeof raw === 'string' && raw !== '' ? Number(raw) : raw; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Canvas API returned invalid ${field}.`); return value as number; }
function requiredWaveform(data: object): readonly number[] { const value = (data as Record<string, unknown>).waveform; if (!Array.isArray(value) || value.length !== 64 || value.some((point) => typeof point !== 'number' || point < 0 || point > 1)) throw new Error('Canvas API returned invalid waveform.'); return value; }
function requiredHttps(data: object, field: string): string { const value = requiredString(data, field); try { if (new URL(value).protocol === 'https:') return value; } catch { /* validated below */ } throw new Error(`Canvas API returned invalid HTTPS ${field}.`); }
function requiredOneOf<T extends string>(data: object, field: string, values: readonly T[]): T { const value = requiredString(data, field); if ((values as readonly string[]).includes(value)) return value as T; throw new Error(`Canvas API returned invalid ${field}.`); }
function optionalOneOf<T extends string>(data: object, field: string, values: readonly T[]): T | undefined { const value = optionalString(data, field); if (!value) return undefined; if ((values as readonly string[]).includes(value)) return value as T; throw new Error(`Canvas API returned invalid ${field}.`); }
