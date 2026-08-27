import { DEFAULT_NODE_DIMENSIONS, type ConnectionHandle, type Placement } from '@dream-weave/canvas-core';

export const DIRECTIONAL_MARKDOWN_GAP = 32;
/** Mirrors Excalidraw FlowChartCreator's 100px spacing between tree siblings. */
export const DIRECTIONAL_TREE_SIBLING_GAP = 100;

export type DirectionalMarkdownKey = 'ArrowUp' | 'ArrowRight' | 'ArrowDown' | 'ArrowLeft';

/**
 * Positions an empty text node just beyond one edge of an existing node while
 * keeping the two nodes centred on their shared axis.
 */
export function getDirectionalMarkdownPlacement(source: Placement, direction: DirectionalMarkdownKey): { x: number; y: number } {
  const [width, height] = DEFAULT_NODE_DIMENSIONS.markdown;
  const centeredX = source.x + (source.width - width) / 2;
  const centeredY = source.y + (source.height - height) / 2;

  switch (direction) {
    case 'ArrowUp': return { x: centeredX, y: source.y - height - DIRECTIONAL_MARKDOWN_GAP };
    case 'ArrowRight': return { x: source.x + source.width + DIRECTIONAL_MARKDOWN_GAP, y: centeredY };
    case 'ArrowDown': return { x: centeredX, y: source.y + source.height + DIRECTIONAL_MARKDOWN_GAP };
    case 'ArrowLeft': return { x: source.x - width - DIRECTIONAL_MARKDOWN_GAP, y: centeredY };
  }
}

export function isDirectionalMarkdownKey(key: string): key is DirectionalMarkdownKey {
  return key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft';
}

/** The old node points toward the new node; the new node receives on its opposite edge. */
export function getDirectionalConnectionHandles(direction: DirectionalMarkdownKey): { sourceHandle: ConnectionHandle; targetHandle: ConnectionHandle } {
  switch (direction) {
    case 'ArrowUp': return { sourceHandle: 'top', targetHandle: 'bottom' };
    case 'ArrowRight': return { sourceHandle: 'right', targetHandle: 'left' };
    case 'ArrowDown': return { sourceHandle: 'bottom', targetHandle: 'top' };
    case 'ArrowLeft': return { sourceHandle: 'left', targetHandle: 'right' };
  }
}

export interface DirectionalTreeNode {
  readonly itemId: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Arranges children on one directional level, centred on the source node.
 * This follows Excalidraw's flowchart shortcut: sibling nodes fan out on the
 * axis perpendicular to the connecting direction rather than overlapping.
 */
export function getDirectionalTreePlacements(source: Placement, children: readonly DirectionalTreeNode[], direction: DirectionalMarkdownKey): { itemId: string; x: number; y: number }[] {
  if (children.length === 0) return [];
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  const totalCrossAxisSize = children.reduce((total, child) => total + (horizontal ? child.height : child.width), 0) + DIRECTIONAL_TREE_SIBLING_GAP * (children.length - 1);
  let crossAxisCursor = (horizontal ? source.y + source.height / 2 : source.x + source.width / 2) - totalCrossAxisSize / 2;

  return children.map((child) => {
    const crossAxisSize = horizontal ? child.height : child.width;
    const placement = horizontal
      ? {
          itemId: child.itemId,
          x: direction === 'ArrowRight' ? source.x + source.width + DIRECTIONAL_MARKDOWN_GAP : source.x - child.width - DIRECTIONAL_MARKDOWN_GAP,
          y: crossAxisCursor,
        }
      : {
          itemId: child.itemId,
          x: crossAxisCursor,
          y: direction === 'ArrowDown' ? source.y + source.height + DIRECTIONAL_MARKDOWN_GAP : source.y - child.height - DIRECTIONAL_MARKDOWN_GAP,
        };
    crossAxisCursor += crossAxisSize + DIRECTIONAL_TREE_SIBLING_GAP;
    return placement;
  });
}
