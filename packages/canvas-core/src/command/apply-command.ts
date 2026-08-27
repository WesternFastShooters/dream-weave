import { assertDocumentInvariants, assertPlacement, cloneDocument, type CanvasDocument } from '../model/canvas-document.js';
import { assertCanvasConnection } from '../model/canvas-connection.js';
import type { CanvasCommand } from './canvas-command.js';

export function applyCommand(document: CanvasDocument, command: CanvasCommand): CanvasDocument {
  if (document.projectId !== command.projectId) throw new Error(`Command '${command.id}' targets a different project.`);
  const next = cloneDocument(document);
  switch (command.type) {
    case 'create-item':
      if (next.items.has(command.item.id)) throw new Error(`Item '${command.item.id}' already exists.`);
      if (command.placement.itemId !== command.item.id) throw new Error('Create item placement must belong to the item.');
      assertPlacement(command.placement);
      next.items.set(command.item.id, structuredClone(command.item));
      next.placements.set(command.item.id, structuredClone(command.placement));
      break;
    case 'update-item': {
      const current = next.items.get(command.item.id);
      if (!current) throw new Error(`Item '${command.item.id}' does not exist.`);
      if (current.kind !== command.item.kind) throw new Error(`Item '${command.item.id}' cannot change kind.`);
      next.items.set(command.item.id, structuredClone(command.item));
      break;
    }
    case 'delete-item':
      deleteItems(next, [command.itemId]);
      break;
    case 'delete-items':
      if (command.itemIds.length === 0) throw new Error('Delete items command must contain at least one item.');
      deleteItems(next, command.itemIds);
      break;
    case 'set-placements': {
      const ids = new Set<string>();
      for (const placement of command.placements) {
        if (ids.has(placement.itemId)) throw new Error(`Duplicate placement for '${placement.itemId}'.`);
        ids.add(placement.itemId);
        if (!next.items.has(placement.itemId)) throw new Error(`Placement references unknown item '${placement.itemId}'.`);
        assertPlacement(placement);
      }
      for (const placement of command.placements) next.placements.set(placement.itemId, structuredClone(placement));
      break;
    }
    case 'create-connection':
      if (next.connections.has(command.connection.id)) throw new Error(`Connection '${command.connection.id}' already exists.`);
      assertConnectionReferences(next, command.connection);
      next.connections.set(command.connection.id, structuredClone(command.connection));
      break;
    case 'update-connection':
      if (!next.connections.has(command.connection.id)) throw new Error(`Connection '${command.connection.id}' does not exist.`);
      assertConnectionReferences(next, command.connection);
      next.connections.set(command.connection.id, structuredClone(command.connection));
      break;
    case 'delete-connection':
      if (!next.connections.delete(command.connectionId)) throw new Error(`Connection '${command.connectionId}' does not exist.`);
      break;
  }
  assertDocumentInvariants(next);
  return next;
}

function deleteItems(document: CanvasDocument, itemIds: readonly string[]): void {
  const ids = new Set(itemIds);
  if (ids.size !== itemIds.length) throw new Error('Delete items command contains duplicate item ids.');
  for (const itemId of ids) if (!document.items.has(itemId)) throw new Error(`Item '${itemId}' does not exist.`);
  for (const itemId of ids) {
    document.items.delete(itemId);
    document.placements.delete(itemId);
  }
  for (const [connectionId, connection] of document.connections) {
    const sourceWasDeleted = Boolean(connection.sourceItemId && ids.has(connection.sourceItemId));
    const targetWasDeleted = Boolean(connection.targetItemId && ids.has(connection.targetItemId));
    if (sourceWasDeleted || targetWasDeleted) document.connections.set(connectionId, {
      ...connection,
      ...(sourceWasDeleted ? { sourceItemId: undefined, sourceHandle: undefined } : {}),
      ...(targetWasDeleted ? { targetItemId: undefined, targetHandle: undefined } : {}),
    });
  }
}

function assertConnectionReferences(document: CanvasDocument, connection: Parameters<typeof assertCanvasConnection>[0]): void {
  assertCanvasConnection(connection);
  if ((connection.sourceItemId && !document.items.has(connection.sourceItemId)) || (connection.targetItemId && !document.items.has(connection.targetItemId))) throw new Error(`Connection '${connection.id}' references an unknown item.`);
}
