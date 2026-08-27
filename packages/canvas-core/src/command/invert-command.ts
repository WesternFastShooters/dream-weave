import type { CanvasDocument } from '../model/canvas-document.js';
import type { CanvasCommand } from './canvas-command.js';

/** Returns ordinary mutations only; deleted nodes are restored by create-item commands. */
export function invertCommand(before: CanvasDocument, command: CanvasCommand): CanvasCommand[] {
  const base = { id: `${command.id}:undo`, projectId: command.projectId, createdAt: command.createdAt, actor: 'system' as const };
  switch (command.type) {
    case 'create-item':
      return [{ ...base, type: 'delete-item', itemId: command.item.id }];
    case 'update-item': {
      const item = before.items.get(command.item.id);
      if (!item) throw new Error(`Cannot invert update for missing item '${command.item.id}'.`);
      return [{ ...base, type: 'update-item', item: structuredClone(item) }];
    }
    case 'delete-item':
      return restoreDeletedItems(before, [command.itemId], base);
    case 'delete-items':
      return restoreDeletedItems(before, command.itemIds, base);
    case 'set-placements': {
      const placements = command.placements.map((placement) => {
        const previous = before.placements.get(placement.itemId);
        if (!previous) throw new Error(`Cannot invert missing placement '${placement.itemId}'.`);
        return structuredClone(previous);
      });
      return [{ ...base, type: 'set-placements', placements }];
    }
    case 'create-connection':
      return [{ ...base, type: 'delete-connection', connectionId: command.connection.id }];
    case 'update-connection': {
      const connection = before.connections.get(command.connection.id);
      if (!connection) throw new Error(`Cannot invert update for missing connection '${command.connection.id}'.`);
      return [{ ...base, type: 'update-connection', connection: structuredClone(connection) }];
    }
    case 'delete-connection': {
      const connection = before.connections.get(command.connectionId);
      if (!connection) throw new Error(`Cannot invert deletion for missing connection '${command.connectionId}'.`);
      return [{ ...base, type: 'create-connection', connection: structuredClone(connection) }];
    }
  }
}

function restoreDeletedItems(
  before: CanvasDocument,
  itemIds: readonly string[],
  base: { id: string; projectId: string; createdAt: string; actor: 'system' },
): CanvasCommand[] {
  const deleted = new Set(itemIds);
  const items = itemIds.map((itemId, index) => restoreDeletedItem(before, itemId, { ...base, id: `${base.id}:item:${index}` }));
  const connections = [...before.connections.values()]
    .filter((connection) => Boolean((connection.sourceItemId && deleted.has(connection.sourceItemId)) || (connection.targetItemId && deleted.has(connection.targetItemId))))
    .map((connection, index): CanvasCommand => ({ ...base, id: `${base.id}:connection:${index}`, type: 'update-connection', connection: structuredClone(connection) }));
  return [...items, ...connections];
}

function restoreDeletedItem(
  before: CanvasDocument,
  itemId: string,
  base: { id: string; projectId: string; createdAt: string; actor: 'system' }
): CanvasCommand {
  const item = before.items.get(itemId);
  const placement = before.placements.get(itemId);
  if (!item || !placement) throw new Error(`Cannot invert deletion for missing item '${itemId}'.`);
  return { ...base, type: 'create-item', item: structuredClone(item), placement: structuredClone(placement) };
}
