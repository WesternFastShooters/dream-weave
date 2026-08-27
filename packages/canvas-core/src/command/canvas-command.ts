import type { CanvasItem } from '../model/canvas-item.js';
import type { CommandId, ItemId, ProjectId } from '../model/ids.js';
import type { Placement } from '../model/placement.js';
import type { CanvasConnection, ConnectionId } from '../model/canvas-connection.js';

export interface CommandBase {
  id: CommandId;
  projectId: ProjectId;
  createdAt: string;
  actor: 'user' | 'system';
}

export interface CreateItemCommand extends CommandBase {
  type: 'create-item';
  item: CanvasItem;
  placement: Placement;
}

export interface UpdateItemCommand extends CommandBase {
  type: 'update-item';
  item: CanvasItem;
}

export interface DeleteItemCommand extends CommandBase {
  type: 'delete-item';
  itemId: ItemId;
}

/** Atomic deletion for a canvas selection. */
export interface DeleteItemsCommand extends CommandBase {
  type: 'delete-items';
  itemIds: ItemId[];
}

export interface SetPlacementsCommand extends CommandBase {
  type: 'set-placements';
  placements: Placement[];
}

export interface CreateConnectionCommand extends CommandBase {
  type: 'create-connection';
  connection: CanvasConnection;
}

export interface UpdateConnectionCommand extends CommandBase {
  type: 'update-connection';
  connection: CanvasConnection;
}

export interface DeleteConnectionCommand extends CommandBase {
  type: 'delete-connection';
  connectionId: ConnectionId;
}

export type PublicCanvasCommand =
  | CreateItemCommand
  | UpdateItemCommand
  | DeleteItemCommand
  | DeleteItemsCommand
  | SetPlacementsCommand
  | CreateConnectionCommand
  | UpdateConnectionCommand
  | DeleteConnectionCommand;

export type CanvasCommand = PublicCanvasCommand;
