import type { ItemId } from './ids.js';

export type ConnectionId = string;
export type ConnectionHandle = 'top' | 'right' | 'bottom' | 'left';
export type ConnectionShape = 'straight' | 'curve' | 'elbow';
export type ConnectionStroke = 'solid' | 'dashed';
export type ConnectionDirection = 'none' | 'forward' | 'both';

/** A persistent canvas annotation. Each end may optionally attach to a node. */
export interface CanvasConnection {
  id: ConnectionId;
  sourceItemId?: ItemId;
  sourceHandle?: ConnectionHandle;
  sourceX: number;
  sourceY: number;
  targetItemId?: ItemId;
  targetHandle?: ConnectionHandle;
  targetX: number;
  targetY: number;
  shape: ConnectionShape;
  stroke: ConnectionStroke;
  direction: ConnectionDirection;
}

export function assertCanvasConnection(connection: CanvasConnection): void {
  if (!connection.id) throw new Error('Canvas connection requires an id.');
  assertEndpoint(connection, 'source');
  assertEndpoint(connection, 'target');
  if (!SHAPES.includes(connection.shape)) throw new Error(`Canvas connection '${connection.id}' has an invalid shape.`);
  if (!STROKES.includes(connection.stroke)) throw new Error(`Canvas connection '${connection.id}' has an invalid stroke.`);
  if (!DIRECTIONS.includes(connection.direction)) throw new Error(`Canvas connection '${connection.id}' has an invalid direction.`);
}

function assertEndpoint(connection: CanvasConnection, end: 'source' | 'target'): void {
  const itemId = connection[`${end}ItemId`];
  const handle = connection[`${end}Handle`];
  const x = connection[`${end}X`];
  const y = connection[`${end}Y`];
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Canvas connection '${connection.id}' has an invalid ${end} position.`);
  if (Boolean(itemId) !== Boolean(handle) || (handle && !HANDLES.includes(handle))) throw new Error(`Canvas connection '${connection.id}' has an invalid ${end} attachment.`);
}

const HANDLES: readonly ConnectionHandle[] = ['top', 'right', 'bottom', 'left'];
const SHAPES: readonly ConnectionShape[] = ['straight', 'curve', 'elbow'];
const STROKES: readonly ConnectionStroke[] = ['solid', 'dashed'];
const DIRECTIONS: readonly ConnectionDirection[] = ['none', 'forward', 'both'];
