import { ICanvasDocumentService, ICanvasHistoryService, type ItemId, type Placement } from '@dream-weave/canvas-core';
import { useService } from '@dream-weave/di';
import { applyNodeChanges, type Edge, type Node, type NodeChange, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ICanvasEventService, type CanvasEventRequest } from './canvas-event-service.interface.js';
import { ICanvasInteractionService, type CanvasInteractionSnapshot } from './canvas-interaction-service.interface.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

export interface CanvasFlowInteraction<TNode extends Node, TEdge extends Edge = Edge> {
  readonly flowNodes: TNode[];
  readonly snapshot: CanvasInteractionSnapshot;
  /** Reads selection synchronously, including selections requested during the current event turn. */
  getSelectedItemIds(): readonly ItemId[];
  onNodesChange(changes: NodeChange<TNode>[]): void;
  onSelectionChange(nodes: readonly Node[]): void;
  /** Applies selection initiated outside React Flow, such as a freeform lasso. */
  applySelection(nodes: readonly Node[]): void;
  onNodeDragStart(nodes: readonly Node[]): void;
  onNodeDragStop(nodes: readonly Node[]): void;
  onMove(viewport: Viewport): void;
  onInit(instance: ReactFlowInstance<TNode, TEdge>): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onKeyUp(event: KeyboardEvent<HTMLElement>): void;
}

/**
 * React Flow adapter for the workspace-scoped interaction services.
 *
 * React Flow owns only the current pointer-time node positions. Commands remain
 * the sole path into CanvasDocument, so drag and deletion work with persistence
 * and undo/redo without making visual state authoritative.
 */
export function useCanvasFlowInteraction<TNode extends Node, TEdge extends Edge = Edge>(sourceNodes: readonly TNode[]): CanvasFlowInteraction<TNode, TEdge> {
  const documentService = useService(ICanvasDocumentService);
  const historyService = useService(ICanvasHistoryService);
  const eventService = useService(ICanvasEventService);
  const interactionService = useService(ICanvasInteractionService);
  const [flowNodes, setFlowNodes] = useState<TNode[]>(() => withSelection(sourceNodes, interactionService.getSnapshot().selectedItemIds));
  const [snapshot, setSnapshot] = useState<CanvasInteractionSnapshot>(() => interactionService.getSnapshot());
  const instanceRef = useRef<ReactFlowInstance<TNode, TEdge> | null>(null);
  const flowNodesRef = useRef<TNode[]>(flowNodes);
  const selectedItemIdsRef = useRef<readonly ItemId[]>(snapshot.selectedItemIds);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const previousToolModeRef = useRef<CanvasInteractionSnapshot['toolMode']>('hand');
  const isSpacePressedRef = useRef(false);
  const frameDragChildrenRef = useRef(new Map<ItemId, readonly ItemId[]>());
  const requestedSelectionRef = useRef<{ itemIds: readonly ItemId[]; expiresAt: number } | null>(null);

  useEffect(() => {
    return interactionService.onDidChange.subscribe((nextSnapshot) => {
      selectedItemIdsRef.current = nextSnapshot.selectedItemIds;
      setSnapshot(nextSnapshot);
    }).dispose;
  }, [interactionService]);

  useEffect(() => {
    const requests = interactionService.onDidRequestNodeResize;
    if (!requests) return;
    return requests.subscribe(({ itemId, height }) => {
      setFlowNodes((currentNodes) => currentNodes.map((node) => (
        node.id === itemId && node.style?.height !== height
          ? { ...node, style: { ...node.style, height } }
          : node
      )));
    }).dispose;
  }, [interactionService]);

  useEffect(() => {
    // React Flow owns the live selection between document updates. Reapplying
    // selected flags after every selection notification creates a controlled
    // selection feedback loop inside React Flow's StoreUpdater.
    setFlowNodes(withSelection(sourceNodes, selectedItemIdsRef.current));
  }, [sourceNodes]);

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  const deleteItemIds = useCallback(
    (rawItemIds: readonly string[]) => {
      const document = documentService.getDocument();
      const itemIds = [...new Set(rawItemIds)].filter((itemId) => document.items.has(itemId)) as ItemId[];
      if (itemIds.length === 0) return;
      historyService.execute({
        ...createCommandBase(document.projectId, 'delete-items'),
        type: 'delete-items',
        itemIds,
      });
      selectedItemIdsRef.current = [];
      interactionService.setSelectedItemIds([]);
      eventService.notify({ type: 'items-deleted', itemIds });
    },
    [documentService, eventService, historyService, interactionService]
  );

  const handleRequest = useCallback(
    (request: CanvasEventRequest) => {
      if (request.type === 'delete-selection') {
        deleteItemIds(interactionService.getSnapshot().selectedItemIds);
        return;
      }
      if (request.type === 'set-tool-mode') {
        interactionService.setToolMode(request.toolMode);
        return;
      }
      if (request.type === 'select-items') {
        const itemIds = [...new Set(request.itemIds)] as ItemId[];
        // React Flow can report the pre-command selection while it incorporates
        // the newly inserted node. Keep that stale callback from undoing this
        // explicit selection request.
        requestedSelectionRef.current = { itemIds, expiresAt: Date.now() + 250 };
        selectedItemIdsRef.current = itemIds;
        interactionService.setSelectedItemIds(itemIds);
        setFlowNodes((currentNodes) => withSelection(currentNodes, itemIds));
        eventService.notify({ type: 'selection-changed', itemIds });
        return;
      }
      const instance = instanceRef.current;
      if (!instance) return;

      if (request.type === 'zoom-in') {
        void instance.zoomTo(clampZoom(instance.getZoom() + ZOOM_STEP), { duration: 160 });
      } else if (request.type === 'zoom-out') {
        void instance.zoomTo(clampZoom(instance.getZoom() - ZOOM_STEP), { duration: 160 });
      } else if (request.type === 'zoom-to') {
        void instance.zoomTo(clampZoom(request.zoom), { duration: 160 });
      } else if (request.type === 'fit-view') {
        void instance.fitView({ padding: 0.15, duration: 180 });
      } else if (request.type === 'center-on-point') {
        void instance.setCenter(request.point.x, request.point.y, { duration: 180 });
      } else if (request.type === 'focus-items') {
        const nodes = flowNodesRef.current.filter((node) => request.itemIds.includes(node.id as ItemId));
        if (nodes.length > 0) void instance.fitView({ nodes, padding: 0.3, duration: 180, maxZoom: 1.25 });
      }
    },
    [deleteItemIds, interactionService]
  );

  useEffect(() => {
    return eventService.onDidRequest.subscribe(handleRequest).dispose;
  }, [eventService, handleRequest]);

  useEffect(() => {
    const flush = () => {
      void documentService.flush().catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [documentService]);

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current);
    };
  }, []);

  const releaseTemporaryHandTool = useCallback(() => {
    if (!isSpacePressedRef.current) return;
    isSpacePressedRef.current = false;
    interactionService.setToolMode(previousToolModeRef.current);
  }, [interactionService]);

  useEffect(() => {
    window.addEventListener('blur', releaseTemporaryHandTool);
    return () => window.removeEventListener('blur', releaseTemporaryHandTool);
  }, [releaseTemporaryHandTool]);

  const onNodesChange = useCallback((changes: NodeChange<TNode>[]) => {
    setFlowNodes((currentNodes) => {
      const nextNodes = applyNodeChanges(changes, currentNodes) as TNode[];
      if (frameDragChildrenRef.current.size === 0) return nextNodes;

      const currentById = new Map(currentNodes.map((node) => [node.id as ItemId, node]));
      const nextById = new Map(nextNodes.map((node) => [node.id as ItemId, node]));
      const directlyMovedIds = new Set(
        changes.filter((change) => change.type === 'position').map((change) => change.id as ItemId),
      );
      const childOffsetById = new Map<ItemId, { x: number; y: number }>();

      for (const [frameId, childIds] of frameDragChildrenRef.current) {
        const previousFrame = currentById.get(frameId);
        const nextFrame = nextById.get(frameId);
        if (!previousFrame || !nextFrame) continue;
        const offset = {
          x: nextFrame.position.x - previousFrame.position.x,
          y: nextFrame.position.y - previousFrame.position.y,
        };
        if (offset.x === 0 && offset.y === 0) continue;
        for (const childId of childIds) {
          if (!directlyMovedIds.has(childId) && !childOffsetById.has(childId)) childOffsetById.set(childId, offset);
        }
      }

      if (childOffsetById.size === 0) return nextNodes;
      return nextNodes.map((node) => {
        const offset = childOffsetById.get(node.id as ItemId);
        return offset ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } : node;
      });
    });
  }, []);

  const onSelectionChange = useCallback(
    (nodes: readonly Node[]) => {
      const itemIds = nodes.map((node) => node.id as ItemId);
      const requestedSelection = requestedSelectionRef.current;
      if (requestedSelection) {
        if (Date.now() > requestedSelection.expiresAt) requestedSelectionRef.current = null;
        else if (!sameItemIds(itemIds, requestedSelection.itemIds)) {
          setFlowNodes((currentNodes) => withSelection(currentNodes, requestedSelection.itemIds));
          return;
        } else requestedSelectionRef.current = null;
      }
      selectedItemIdsRef.current = itemIds;
      interactionService.setSelectedItemIds(itemIds);
      eventService.notify({ type: 'selection-changed', itemIds });
    },
    [eventService, interactionService]
  );

  const applySelection = useCallback((nodes: readonly Node[]) => {
    const itemIds = nodes.map((node) => node.id as ItemId);
    setFlowNodes((currentNodes) => withSelection(currentNodes, itemIds));
  }, []);

  const onNodeDragStart = useCallback(
    (nodes: readonly Node[]) => {
      const itemIds = nodes.map((node) => node.id as ItemId);
      const document = documentService.getDocument();
      const selectedIds = new Set(itemIds);
      frameDragChildrenRef.current = new Map(
        itemIds
          .filter((itemId) => document.items.get(itemId)?.kind === 'frame')
          .map((frameId) => [frameId, findFrameChildIds(document.placements, frameId, selectedIds)]),
      );
      interactionService.setDragging(true);
      selectedItemIdsRef.current = itemIds;
      interactionService.setSelectedItemIds(itemIds);
      setFlowNodes((currentNodes) => withSelection(currentNodes, itemIds));
      eventService.notify({ type: 'node-drag-started', itemIds });
    },
    [documentService, eventService, interactionService]
  );

  const onNodeDragStop = useCallback(
    (nodes: readonly Node[]) => {
      interactionService.setDragging(false);
      const document = documentService.getDocument();
      const placementsById = new Map<ItemId, Placement>();
      for (const node of nodes) {
        const current = document.placements.get(node.id as ItemId);
        if (!current || (current.x === node.position.x && current.y === node.position.y)) continue;
        placementsById.set(current.itemId, { ...current, x: node.position.x, y: node.position.y });
      }
      const droppedNodesById = new Map(nodes.map((node) => [node.id as ItemId, node]));
      for (const [frameId, childIds] of frameDragChildrenRef.current) {
        const frame = droppedNodesById.get(frameId);
        const originalFramePlacement = document.placements.get(frameId);
        if (!frame || !originalFramePlacement) continue;
        const offset = {
          x: frame.position.x - originalFramePlacement.x,
          y: frame.position.y - originalFramePlacement.y,
        };
        if (offset.x === 0 && offset.y === 0) continue;
        for (const childId of childIds) {
          const childPlacement = document.placements.get(childId);
          if (!childPlacement || placementsById.has(childId)) continue;
          placementsById.set(childId, {
            ...childPlacement,
            x: childPlacement.x + offset.x,
            y: childPlacement.y + offset.y,
          });
        }
      }
      frameDragChildrenRef.current.clear();
      const placements = [...placementsById.values()];
      if (placements.length > 0) {
        historyService.execute({
          ...createCommandBase(document.projectId, 'set-placements'),
          type: 'set-placements',
          placements,
        }, `drag:${placements.map((placement) => placement.itemId).sort().join(',')}`);
      }
      eventService.notify({ type: 'node-drag-ended', itemIds: nodes.map((node) => node.id as ItemId) });
    },
    [documentService, eventService, historyService, interactionService]
  );

  const onMove = useCallback(
    (viewport: Viewport) => {
      pendingViewportRef.current = viewport;
      if (viewportFrameRef.current !== null) return;
      viewportFrameRef.current = requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        const nextViewport = pendingViewportRef.current;
        if (!nextViewport) return;
        interactionService.setViewport(nextViewport);
        eventService.notify({ type: 'viewport-changed', viewport: nextViewport });
      });
    },
    [eventService, interactionService]
  );

  const onInit = useCallback((nextInstance: ReactFlowInstance<TNode, TEdge>) => {
    instanceRef.current = nextInstance;
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey;
      if (hasModifier && (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_')) {
        event.preventDefault();
        eventService.request({ type: event.key === '-' || event.key === '_' ? 'zoom-out' : 'zoom-in' });
        return;
      }
      if (hasModifier && !event.altKey && key === 'a') {
        event.preventDefault();
        const itemIds = flowNodesRef.current.map((node) => node.id as ItemId);
        selectedItemIdsRef.current = itemIds;
        interactionService.setSelectedItemIds(itemIds);
        setFlowNodes((currentNodes) => withSelection(currentNodes, itemIds));
        eventService.notify({ type: 'selection-changed', itemIds });
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        if (!isSpacePressedRef.current) {
          previousToolModeRef.current = interactionService.getSnapshot().toolMode;
          isSpacePressedRef.current = true;
          interactionService.setToolMode('hand');
        }
        return;
      }
      if (!hasModifier && !event.altKey && key === 'v') {
        event.preventDefault();
        interactionService.setToolMode('pointer');
        return;
      }
      if (!hasModifier && !event.altKey && key === 'h') {
        event.preventDefault();
        interactionService.setToolMode('hand');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        interactionService.setToolMode('pointer');
        selectedItemIdsRef.current = [];
        interactionService.setSelectedItemIds([]);
        setFlowNodes((currentNodes) => withSelection(currentNodes, []));
        eventService.notify({ type: 'selection-changed', itemIds: [] });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (snapshot.selectedItemIds.length === 0) return;
        event.preventDefault();
        deleteItemIds(snapshot.selectedItemIds);
      }
    },
    [deleteItemIds, eventService, historyService, interactionService, snapshot.selectedItemIds]
  );

  const onKeyUp = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      releaseTemporaryHandTool();
    },
    [releaseTemporaryHandTool]
  );

  return { flowNodes, snapshot, getSelectedItemIds: () => selectedItemIdsRef.current, onNodesChange, onSelectionChange, applySelection, onNodeDragStart, onNodeDragStop, onMove, onInit, onKeyDown, onKeyUp };
}

/** A frame groups the nodes fully enclosed by its current rectangle. */
function findFrameChildIds(placements: ReadonlyMap<ItemId, Placement>, frameId: ItemId, excludedIds: ReadonlySet<ItemId>): ItemId[] {
  const frame = placements.get(frameId);
  if (!frame) return [];
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;
  return [...placements.values()]
    .filter((placement) => placement.itemId !== frameId && !excludedIds.has(placement.itemId))
    .filter((placement) => (
      placement.x >= frame.x
      && placement.y >= frame.y
      && placement.x + placement.width <= frameRight
      && placement.y + placement.height <= frameBottom
    ))
    .map((placement) => placement.itemId);
}

function withSelection<TNode extends Node>(nodes: readonly TNode[], selectedItemIds: readonly ItemId[]): TNode[] {
  const selected = new Set(selectedItemIds);
  return nodes.map((node) => (node.selected === selected.has(node.id as ItemId) ? node : { ...node, selected: selected.has(node.id as ItemId) }));
}

function sameItemIds(left: readonly ItemId[], right: readonly ItemId[]): boolean {
  return left.length === right.length && left.every((itemId, index) => itemId === right[index]);
}

function createCommandBase(projectId: string, type: string) {
  return {
    id: `canvas:${type}:${createId()}`,
    projectId,
    createdAt: new Date().toISOString(),
    actor: 'user' as const,
  };
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}
