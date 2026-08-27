import type { CanvasCommand } from '../command/canvas-command.js';
import type { CanvasItem } from '../model/canvas-item.js';
import type { Placement } from '../model/placement.js';
import type { CanvasConnection } from '../model/canvas-connection.js';
import type {
  ApplyCanvasMutationsRequest,
  CanvasMutation,
  Placement as GeneratedPlacement,
  CanvasConnection as GeneratedCanvasConnection,
} from './generated/dreamweave/v1/index.js';

export type ApiPlacement = GeneratedPlacement;
export type CanvasMutationDto = CanvasMutation;
export type ApplyCanvasMutationsRequestDto = ApplyCanvasMutationsRequest;

export function toApiPlacement(value: Placement): ApiPlacement {
  return { nodeId: value.itemId, x: value.x, y: value.y, width: value.width, height: value.height, zIndex: value.zIndex };
}
export function toApiConnection(value: CanvasConnection): GeneratedCanvasConnection {
  return {
    id: value.id, sourceNodeId: value.sourceItemId, sourceHandle: value.sourceHandle, sourceX: value.sourceX, sourceY: value.sourceY,
    targetNodeId: value.targetItemId, targetHandle: value.targetHandle, targetX: value.targetX, targetY: value.targetY,
    shape: value.shape, stroke: value.stroke, direction: value.direction,
  };
}
export function adaptCanvasCommand(command: CanvasCommand): CanvasMutationDto {
  switch (command.type) {
    case 'create-item': return createMutation(command.item, command.placement);
    case 'update-item':
      if (command.item.kind === 'markdown') return { updateMarkdownNode: { nodeId: command.item.id, markdown: command.item.markdown } };
      if (command.item.kind === 'frame') return { updateFrameNode: { nodeId: command.item.id, title: command.item.title } };
      throw new Error('Only markdown and Frame nodes can be updated by the public canvas protocol.');
    case 'delete-item': return { deleteNodes: { nodeIds: [command.itemId] } };
    case 'delete-items': return { deleteNodes: { nodeIds: [...command.itemIds] } };
    case 'set-placements': return { setPlacements: { placements: command.placements.map(toApiPlacement) } };
    case 'create-connection': return { createConnection: { connection: toApiConnection(command.connection) } };
    case 'update-connection': return { updateConnection: { connection: toApiConnection(command.connection) } };
    case 'delete-connection': return { deleteConnections: { connectionIds: [command.connectionId] } };
  }
}
export function adaptCanvasCommands(projectId: string, expectedRevision: number, commands: readonly CanvasCommand[]): ApplyCanvasMutationsRequestDto {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Canvas revision must be a non-negative safe integer.');
  if (commands.length === 0) throw new Error('Canvas command batches must not be empty.');
  if (commands.some((command) => command.projectId !== projectId)) throw new Error('Canvas command batch targets a different project.');
  return { projectId, expectedRevision: String(expectedRevision), requestId: requestIdFor(commands), mutations: commands.map(adaptCanvasCommand) };
}

/**
 * Receipts require a UUID. Command ids are deliberately opaque (and batches
 * can contain more than one), so encode the batch identity as a stable UUID.
 */
function requestIdFor(commands: readonly CanvasCommand[]): string {
  const source = commands.map((command) => command.id).join('\u0000');
  const word = (seed: number) => {
    let hash = seed >>> 0;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const hex = `${word(0x811c9dc5)}${word(0x9e3779b9)}${word(0x85ebca6b)}${word(0xc2b2ae35)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function createMutation(item: CanvasItem, placement: Placement): CanvasMutationDto {
  if (item.kind === 'markdown') return { createMarkdownNode: { nodeId: item.id, markdown: item.markdown, placement: toApiPlacement(placement) } };
  if (item.kind === 'frame') return { createFrameNode: { nodeId: item.id, frameData: { title: item.title, description: item.description, color: item.color }, placement: toApiPlacement(placement) } };
  return { createAssetNode: { nodeId: item.id, assetId: item.assetId, placement: toApiPlacement(placement) } };
}
