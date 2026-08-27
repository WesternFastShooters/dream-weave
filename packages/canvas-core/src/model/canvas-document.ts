import type { CanvasItem } from './canvas-item.js';
import type { ItemId, ProjectId } from './ids.js';
import type { Placement } from './placement.js';
import { assertCanvasConnection, type CanvasConnection, type ConnectionId } from './canvas-connection.js';

export interface CanvasDocument {
  projectId: ProjectId;
  /** Last server-confirmed revision. Local commands are optimistic and do not increment it. */
  revision: number;
  items: Map<ItemId, CanvasItem>;
  placements: Map<ItemId, Placement>;
  connections: Map<ConnectionId, CanvasConnection>;
}

export interface CanvasDocumentSnapshot {
  projectId: ProjectId;
  revision: number;
  items: CanvasItem[];
  placements: Placement[];
  connections: CanvasConnection[];
}

export function createEmptyDocument(projectId: ProjectId): CanvasDocument {
  return { projectId, revision: 0, items: new Map(), placements: new Map(), connections: new Map() };
}

export function documentFromSnapshot(snapshot: CanvasDocumentSnapshot): CanvasDocument {
  const document: CanvasDocument = {
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    items: new Map(snapshot.items.map((item) => [item.id, clone(item)])),
    placements: new Map(snapshot.placements.map((placement) => [placement.itemId, clone(placement)])),
    connections: new Map(snapshot.connections.map((connection) => [connection.id, clone(connection)])),
  };
  assertDocumentInvariants(document);
  return document;
}

export function documentToSnapshot(document: CanvasDocument): CanvasDocumentSnapshot {
  assertDocumentInvariants(document);
  return {
    projectId: document.projectId,
    revision: document.revision,
    items: [...document.items.values()].map(clone),
    placements: [...document.placements.values()].map(clone),
    connections: [...document.connections.values()].map(clone),
  };
}

export function cloneDocument(document: CanvasDocument): CanvasDocument {
  return documentFromSnapshot(documentToSnapshot(document));
}

export function assertDocumentInvariants(document: CanvasDocument): void {
  for (const [itemId, item] of document.items) {
    if (item.id !== itemId) throw new Error(`Item map key does not match item id: ${itemId}`);
    assertCanvasItem(item);
    const placement = document.placements.get(itemId);
    if (!placement) throw new Error(`Item '${itemId}' has no placement.`);
    assertPlacement(placement);
  }
  for (const placement of document.placements.values()) {
    if (!document.items.has(placement.itemId)) throw new Error(`Placement references unknown item '${placement.itemId}'.`);
    assertPlacement(placement);
  }
  for (const [connectionId, connection] of document.connections) {
    if (connection.id !== connectionId) throw new Error(`Connection map key does not match connection id: ${connectionId}`);
    assertCanvasConnection(connection);
    if ((connection.sourceItemId && !document.items.has(connection.sourceItemId)) || (connection.targetItemId && !document.items.has(connection.targetItemId))) throw new Error(`Connection '${connectionId}' references an unknown item.`);
  }
}


export function assertCanvasItem(item: CanvasItem): void {
  if (!item.id || !item.title || typeof item.summary !== 'string') throw new Error('Canvas items require id, title, and summary.');
  for (const [name, value] of [['createdAt', item.createdAt], ['updatedAt', item.updatedAt]] as const) {
    if (Number.isNaN(Date.parse(value)) || !value.endsWith('Z')) throw new Error(`Canvas item '${item.id}' has invalid ${name}.`);
  }
  const requireAsset = () => { if (!(item as { assetId?: string }).assetId) throw new Error(`Canvas item '${item.id}' requires an asset id.`); };
  switch (item.kind) {
    case 'markdown':
      if (typeof item.markdown !== 'string') throw new Error(`Markdown item '${item.id}' requires markdown.`);
      return;
    case 'image':
      requireAsset(); if (typeof item.previewAvailable !== 'boolean' || !item.format) throw new Error(`Image item '${item.id}' is invalid.`); return;
    case 'audio':
      requireAsset();
      if (!item.format || !Number.isInteger(item.durationMs) || item.durationMs < 0 || item.waveform.length !== 64 || item.waveform.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || typeof item.sceneLabel !== 'string') throw new Error(`Audio item '${item.id}' is invalid.`);
      return;
    case 'video':
      requireAsset(); if (typeof item.posterAvailable !== 'boolean' || !Number.isInteger(item.durationMs) || item.durationMs < 0 || typeof item.shotLabel !== 'string') throw new Error(`Video item '${item.id}' is invalid.`); return;
    case 'web-preview':
      requireAsset();
      try { if (new URL(item.url).protocol !== 'https:') throw new Error(); } catch { throw new Error(`Web preview item '${item.id}' requires an HTTPS URL.`); }
      if (typeof item.embeddable !== 'boolean') throw new Error(`Web preview item '${item.id}' is invalid.`);
      return;
    case 'html':
      requireAsset(); if (typeof item.previewAvailable !== 'boolean') throw new Error(`HTML item '${item.id}' is invalid.`); return;
    case 'pdf':
      requireAsset(); if (typeof item.previewAvailable !== 'boolean') throw new Error(`PDF item '${item.id}' is invalid.`); return;
    case 'office': {
      requireAsset();
      const expectedType = item.fileType === 'doc' || item.fileType === 'docx' ? 'word' : item.fileType === 'xls' || item.fileType === 'xlsx' ? 'spreadsheet' : item.fileType === 'ppt' || item.fileType === 'pptx' ? 'presentation' : null;
      if (!expectedType || item.officeKind !== expectedType || typeof item.previewAvailable !== 'boolean') throw new Error(`Office item '${item.id}' is invalid.`);
      return;
    }
    case 'frame':
      if (typeof item.description !== 'string' || !item.color) throw new Error(`Frame item '${item.id}' is invalid.`); return;
  }
}

export function assertPlacement(placement: Placement): void {
  for (const value of [placement.x, placement.y, placement.width, placement.height, placement.zIndex]) {
    if (!Number.isFinite(value)) throw new Error(`Placement '${placement.itemId}' has a non-finite numeric value.`);
  }
  if (placement.width <= 0 || placement.height <= 0) throw new Error(`Placement '${placement.itemId}' must have positive dimensions.`);
  if (!Number.isInteger(placement.zIndex)) throw new Error(`Placement '${placement.itemId}' must have an integer z-index.`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
