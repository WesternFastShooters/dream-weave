import { DEFAULT_NODE_DIMENSIONS, type CanvasDocument, type CanvasItem, type CanvasItemKind, type Placement } from '@dream-weave/canvas-core';
import type { Node, NodeTypes } from '@xyflow/react';

export interface CanvasFlowNodeData extends Record<string, unknown> {
  item: CanvasItem;
  /** Transient instruction for a newly-created text node to enter editing. */
  startEditing?: boolean;
}
export type CanvasFlowNode = Node<CanvasFlowNodeData>;

/** One product renderer for one and only one persisted node kind. */
export interface CanvasNodeRenderer {
  readonly type: string;
  readonly kind: CanvasItemKind;
  readonly component: NodeTypes[string];
}

const ALL_KINDS: readonly CanvasItemKind[] = [
  'markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame',
];

/** Strict projection boundary: persisted nodes are never silently dropped. */
export class CanvasNodeRegistry {
  private readonly renderers = new Map<CanvasItemKind, CanvasNodeRenderer>();

  public register(renderer: CanvasNodeRenderer): void {
    if (this.renderers.has(renderer.kind)) throw new Error(`A canvas renderer is already registered for '${renderer.kind}'.`);
    if ([...this.renderers.values()].some((registered) => registered.type === renderer.type)) {
      throw new Error(`A canvas renderer type is already registered for '${renderer.type}'.`);
    }
    this.renderers.set(renderer.kind, renderer);
  }

  public project(document: CanvasDocument, options: { startEditingItemId?: string } = {}): CanvasFlowNode[] {
    this.assertComplete();
    const nodes: CanvasFlowNode[] = [];
    const lowestContentZIndex = Math.min(
      0,
      ...[...document.items.values()]
        .filter((item) => item.kind !== 'frame')
        .map((item) => document.placements.get(item.id)?.zIndex ?? 0),
    );
    for (const item of document.items.values()) {
      const placement = document.placements.get(item.id);
      if (!placement) throw new Error(`Canvas item '${item.id}' has no placement.`);
      const renderer = this.renderers.get(item.kind);
      if (!renderer) throw new Error(`No canvas renderer is registered for '${item.kind}'.`);
      // Frames are visual grouping surfaces. They must stay behind every
      // canvas node, including legacy Frames whose stored z-index predates
      // that invariant, so the enclosed nodes always receive pointer input.
      // React Flow's pane sits above the base stacking level, so Frames use
      // level one and every content node is shifted above it. This retains
      // the stored content order while keeping Frame blank space draggable.
      const zIndex = item.kind === 'frame' ? 1 : placement.zIndex - lowestContentZIndex + 2;
      nodes.push(this.createNode(item, placement, renderer.type, zIndex, item.id === options.startEditingItemId));
    }
    return nodes;
  }

  public getNodeTypes(): NodeTypes {
    this.assertComplete();
    return Object.fromEntries([...this.renderers.values()].map((renderer) => [renderer.type, renderer.component]));
  }

  private assertComplete(): void {
    const missing = ALL_KINDS.filter((kind) => !this.renderers.has(kind));
    if (missing.length > 0) throw new Error(`Canvas node registry is incomplete; missing renderers: ${missing.join(', ')}.`);
  }

  private createNode(item: CanvasItem, placement: Placement, type: string, zIndex: number, startEditing: boolean): CanvasFlowNode {
    // A video card's rendered height is defined by its responsive poster,
    // controls, and 16px card padding. Older documents stored a taller fixed
    // placement, which left a transparent-but-clickable React Flow area below
    // the card. Project the hit box from its current width instead.
    const width = item.kind === 'markdown' ? DEFAULT_NODE_DIMENSIONS.markdown[0] : placement.width;
    const height = item.kind === 'video' ? videoNodeHeight(placement.width) : placement.height;
    return {
      id: item.id,
      type,
      position: { x: placement.x, y: placement.y },
      data: { item, startEditing: startEditing || undefined },
      style: { width, height },
      zIndex,
      // A Frame's label deliberately sits outside its rectangle. Let the
      // complete Frame receive drag input so both its blank surface and label
      // can move it; its rename input remains protected by the `nodrag` class.
      ...(item.kind === 'frame' ? {} : { dragHandle: '[data-drag-handle]' }),
    };
  }
}

function videoNodeHeight(width: number): number {
  const horizontalPadding = 32;
  const controlsAndVerticalPadding = 62;
  return Math.ceil(Math.max(0, width - horizontalPadding) * 0.72 + controlsAndVerticalPadding);
}
