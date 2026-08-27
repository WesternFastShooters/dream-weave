import { DEFAULT_NODE_DIMENSIONS, ICanvasDocumentService, ICanvasHistoryService, type CanvasConnection, type CanvasDocument, type ConnectionHandle, type ICanvasAssetUploadService, type Placement } from '@dream-weave/canvas-core';
import { ICanvasEventService, useCanvasFlowInteraction } from '@dream-weave/canvas-interaction';
import { useService } from '@dream-weave/di';
import { Background, PanOnScrollMode, ReactFlow, SelectionMode, type Edge, type EdgeChange, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvas-renderer.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { CSSProperties, ReactElement, RefObject } from 'react';
import { type CanvasFlowNode, CanvasNodeRegistry } from './canvas-node-registry.js';
import { CanvasViewportRadar } from './canvas-viewport-radar.js';
import { CanvasBottomToolbar } from './canvas-bottom-toolbar.js';
import { CanvasConnectionEdge, CanvasConnectionLine, CanvasConnectionToolbar, CONNECTION_COLORS, DEFAULT_CONNECTION_STYLE, getConnectionAttachmentArrowOrientation, type CanvasConnectionData, type CanvasConnectionStyle } from './canvas-connection-edge.js';
import { getDirectionalConnectionHandles, getDirectionalMarkdownPlacement, getDirectionalTreePlacements, isDirectionalMarkdownKey, type DirectionalMarkdownKey } from './directional-markdown-placement.js';
import { useCanvasWheelZoom } from './canvas-wheel-zoom-handler.js';
import { useCanvasHistoryShortcuts } from './use-canvas-history-shortcuts.js';

const POINTER_PAN_BUTTONS = [1, 2];
const MIN_FRAME_DRAW_SIZE = 24;
const WEB_PREVIEW_PLACEMENT_DIMENSIONS = [520, 360] as const;
const CONNECTION_BORDER_SELECTOR_BY_NODE_KIND: Readonly<Record<string, string>> = {
  markdown: '.dw-product-brief__surface', image: '.dw-resource-node__surface', audio: '.dw-audio-node__surface', video: '.dw-video-node__surface',
  'web-preview': '.dw-resource-node__surface', html: '.dw-resource-node__surface', pdf: '.dw-resource-node__surface', office: '.dw-resource-node__surface', frame: '.dw-frame-node',
};

type FrameDrawDraft = {
  pointerId: number;
  startFlow: { x: number; y: number };
  currentFlow: { x: number; y: number };
  startScreen: { x: number; y: number };
  currentScreen: { x: number; y: number };
};

type FreeformLassoDraft = {
  pointerId: number;
  points: { x: number; y: number }[];
};

type ConnectionDrawDraft = {
  pointerId: number;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
};

type ConnectionEndpoint = {
  itemId?: string;
  handle?: ConnectionHandle;
  x: number;
  y: number;
};

type ConnectionEndpointDrag = {
  pointerId: number;
  connectionId: string;
  endpoint: 'source' | 'target';
  x: number;
  y: number;
};

type RectangleLassoStart = {
  x: number;
  y: number;
  append: boolean;
};

type PlacementDraft = {
  kind: 'markdown' | 'web';
  phase: 'moving' | 'input' | 'saving';
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  zoom: number;
  hasPointerPosition: boolean;
  url: string;
  error: string | null;
};

type MarkdownConnectionOrigin = {
  sourceItemId: string;
  sourceHandle: ConnectionHandle;
  targetHandle: ConnectionHandle;
};

export interface CanvasRendererProps {
  readonly nodeRegistry: CanvasNodeRegistry;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Handles asset uploads initiated from the canvas toolbar. */
  readonly assetUpload?: ICanvasAssetUploadService;
  /** Creates the Asset-backed web node after its transient URL composer is submitted. */
  readonly createWebPreview?: (url: string, placement: Placement) => Promise<void>;
}

/**
 * Rendering bridge from the project canvas document to React Flow.
 *
 * Product node renderers remain outside this package. Generic interaction is
 * supplied by @dream-weave/canvas-interaction through the workspace DI scope.
 */
export function CanvasRenderer({ nodeRegistry, className, style, assetUpload, createWebPreview }: CanvasRendererProps): ReactElement {
  const documentService = useService(ICanvasDocumentService);
  const history = useService(ICanvasHistoryService);
  const events = useService(ICanvasEventService);
  const [document, setDocument] = useState<CanvasDocument>(() => documentService.getDocument());
  // React Flow defers fitView until a node has a measured size. Keep that
  // initial-only behavior for populated documents, but never queue it for an
  // empty canvas: otherwise the first placed node becomes the fit target.
  const [fitInitialDocument] = useState(() => documentService.getDocument().items.size > 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useElementSize(containerRef);
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode, Edge<CanvasConnectionData>> | null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge<CanvasConnectionData>> | null>(null);
  const [sideDrawer, setSideDrawer] = useState<{ side: 'right'; open: boolean; width: number }>({ side: 'right', open: false, width: 0 });
  const appliedSideDrawerWidth = useRef(0);
  flowRef.current = flow;
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [startEditingItemId, setStartEditingItemId] = useState<string | undefined>();
  const [draft, setDraft] = useState<PlacementDraft | null>(null);
  const [isFrameDrawing, setIsFrameDrawing] = useState(false);
  const [frameDrawDraft, setFrameDrawDraft] = useState<FrameDrawDraft | null>(null);
  const [freeformLassoDraft, setFreeformLassoDraft] = useState<FreeformLassoDraft | null>(null);
  const freeformLassoDraftRef = useRef<FreeformLassoDraft | null>(null);
  const [lassoShape, setLassoShape] = useState<'rectangle' | 'line'>('rectangle');
  const [connectionDrawDraft, setConnectionDrawDraft] = useState<ConnectionDrawDraft | null>(null);
  const [connectionEndpointDrag, setConnectionEndpointDrag] = useState<ConnectionEndpointDrag | null>(null);
  const rectangleLassoStartRef = useRef<RectangleLassoStart | null>(null);
  const [connectionAnchorPlacements, setConnectionAnchorPlacements] = useState<ReadonlyMap<string, Placement>>(() => new Map());

  useEffect(() => {
    const subscription = documentService.onDidChange.subscribe(({ document: nextDocument }) => {
      setDocument(nextDocument);
    });
    return () => subscription.dispose();
  }, [documentService]);
  useEffect(() => events.onDidRequest.subscribe((request) => {
    if (request.type === 'set-side-drawer') setSideDrawer(request);
  }).dispose, [events]);
  useEffect(() => {
    if (!flow) return;
    const nextWidth = sideDrawer.open && sideDrawer.side === 'right' ? sideDrawer.width : 0;
    const delta = nextWidth - appliedSideDrawerWidth.current;
    if (delta === 0) return;
    const viewport = flow.getViewport();
    // Keep the active canvas content centered in the usable viewport. Applying
    // only the width delta also preserves any pan the user performs while the
    // drawer is open, then reverses the offset when it closes.
    void flow.setViewport({ ...viewport, x: viewport.x - delta / 2 }, { duration: 180 });
    appliedSideDrawerWidth.current = nextWidth;
  }, [flow, sideDrawer]);
  // `startEditingItemId` is an edge-triggered instruction for the node, not
  // persistent state. Clearing it after projection means Escape can return the
  // node to readonly mode and a later Enter can request editing again.
  useEffect(() => {
    if (startEditingItemId) setStartEditingItemId(undefined);
  }, [startEditingItemId]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDraft(null);
      setFrameDrawDraft(null);
      freeformLassoDraftRef.current = null;
      setFreeformLassoDraft(null);
      setIsFrameDrawing(false);
      setConnectionDrawDraft(null);
      setConnectionEndpointDrag(null);
      rectangleLassoStartRef.current = null;
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const nodes = useMemo(() => nodeRegistry.project(document, { startEditingItemId }), [document, nodeRegistry, startEditingItemId]);
  const nodeTypes = useMemo(() => nodeRegistry.getNodeTypes(), [nodeRegistry]);
  const edgeTypes = useMemo(() => ({ 'dream-weave-connection': CanvasConnectionEdge }), []);
  const interaction = useCanvasFlowInteraction<CanvasFlowNode, Edge<CanvasConnectionData>>(nodes);
  useLayoutEffect(() => {
    if (!flow || !containerRef.current) return;
    const measure = () => {
      const next = new Map<string, Placement>();
      for (const node of interaction.flowNodes) {
        const placement = document.placements.get(node.id);
        const outer = containerRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
        const border = outer?.querySelector<HTMLElement>(CONNECTION_BORDER_SELECTOR_BY_NODE_KIND[node.data.item.kind] ?? '.dw-node');
        if (!placement || !border) continue;
        const rect = border.getBoundingClientRect();
        const start = flow.screenToFlowPosition({ x: rect.left, y: rect.top });
        const end = flow.screenToFlowPosition({ x: rect.right, y: rect.bottom });
        next.set(node.id, { ...placement, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y });
      }
      setConnectionAnchorPlacements((current) => samePlacements(current, next) ? current : next);
    };
    measure();
  }, [document.placements, flow, interaction.flowNodes]);
  // React Flow owns node positions while a drag is in progress. Use those
  // transient positions to keep attached connection ends visually glued to
  // the node, then persist the same anchors after the drag completes.
  const connectionPlacements = useMemo(() => {
    const placements = new Map(document.placements);
    for (const node of interaction.flowNodes) {
      const placement = placements.get(node.id);
      if (placement) placements.set(node.id, { ...placement, x: node.position.x, y: node.position.y });
    }
    for (const [itemId, placement] of connectionAnchorPlacements) placements.set(itemId, placement);
    return placements;
  }, [connectionAnchorPlacements, document.placements, interaction.flowNodes]);
  const isPointerTool = interaction.snapshot.toolMode === 'pointer';
  const isConnectionTool = interaction.snapshot.toolMode === 'connection';
  useCanvasHistoryShortcuts();
  useCanvasWheelZoom(containerRef, flow);
  const deleteConnections = (connectionIds: readonly string[]) => {
    const existingIds = connectionIds.filter((connectionId) => document.connections.has(connectionId));
    if (existingIds.length === 0) return;
    history.executeBatch(existingIds.map((connectionId) => ({ ...commandBase(document.projectId), type: 'delete-connection' as const, connectionId })));
    setSelectedEdgeIds((current) => {
      const next = new Set(current);
      for (const connectionId of existingIds) next.delete(connectionId);
      return next;
    });
  };
  const updateConnectionStyle = (edgeId: string, patch: Partial<CanvasConnectionStyle>) => {
    const current = document.connections.get(edgeId);
    if (!current) return;
    history.execute({ ...commandBase(document.projectId), type: 'update-connection', connection: { ...current, ...patch } });
  };
  const selectConnections = (connectionIds: readonly string[], append: boolean) => {
    setSelectedEdgeIds((current) => {
      const next = new Set(append ? current : []);
      for (const connectionId of connectionIds) next.add(connectionId);
      return next;
    });
  };
  const selectConnectionsInRectangle = (start: { x: number; y: number }, end: { x: number; y: number }, append: boolean) => {
    const viewport = flowRef.current;
    if (!viewport) return;
    const startFlow = viewport.screenToFlowPosition(start);
    const endFlow = viewport.screenToFlowPosition(end);
    const rectangle = {
      left: Math.min(startFlow.x, endFlow.x), top: Math.min(startFlow.y, endFlow.y),
      right: Math.max(startFlow.x, endFlow.x), bottom: Math.max(startFlow.y, endFlow.y),
    };
    const connectionIds = [...document.connections.values()]
      .map((connection) => anchorConnectionToPlacements(connection, connectionPlacements))
      .filter((connection) => connectionIntersectsRectangle(connection, rectangle))
      .map((connection) => connection.id);
    selectConnections(connectionIds, append);
  };
  const selectConnectionsInFreeformLasso = (screenPoints: readonly { x: number; y: number }[], append: boolean) => {
    if (screenPoints.length < 3) return;
    const viewport = interaction.snapshot.viewport;
    const flowPoints = screenPoints.map((point) => ({ x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }));
    const connectionIds = [...document.connections.values()]
      .map((connection) => anchorConnectionToPlacements(connection, connectionPlacements))
      .filter((connection) => connectionIntersectsPolygon(connection, flowPoints))
      .map((connection) => connection.id);
    selectConnections(connectionIds, append);
  };
  const beginConnectionEndpointDrag = (connectionId: string, endpoint: 'source' | 'target', event: ReactPointerEvent<SVGCircleElement>) => {
    const connection = document.connections.get(connectionId);
    if (!connection) return;
    const anchored = anchorConnectionToPlacements(connection, connectionPlacements);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedEdgeIds(new Set([connectionId]));
    setConnectionEndpointDrag({
      pointerId: event.pointerId,
      connectionId,
      endpoint,
      x: endpoint === 'source' ? anchored.sourceX : anchored.targetX,
      y: endpoint === 'source' ? anchored.sourceY : anchored.targetY,
    });
  };
  const moveConnectionEndpointDrag = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (connectionEndpointDrag?.pointerId !== event.pointerId) return;
    const point = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setConnectionEndpointDrag((current) => current?.pointerId === event.pointerId ? { ...current, x: point.x, y: point.y } : current);
  };
  const finishConnectionEndpointDrag = (event: ReactPointerEvent<SVGCircleElement>) => {
    const drag = connectionEndpointDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = canvasDropTargetAt(event.clientX, event.clientY);
    const endpoint = connectionEndpointAtScreen(event.clientX, event.clientY, flowRef.current, connectionPlacements, target);
    const connection = document.connections.get(drag.connectionId);
    setConnectionEndpointDrag(null);
    if (!connection || !endpoint) return;
    const attachment = drag.endpoint === 'source'
      ? { sourceItemId: endpoint.itemId, sourceHandle: endpoint.handle, sourceX: endpoint.x, sourceY: endpoint.y }
      : { targetItemId: endpoint.itemId, targetHandle: endpoint.handle, targetX: endpoint.x, targetY: endpoint.y };
    history.execute({ ...commandBase(document.projectId), type: 'update-connection', connection: { ...connection, ...attachment } });
  };
  const edges: Edge<CanvasConnectionData>[] = [];
  const onEdgesChange = (changes: EdgeChange<Edge<CanvasConnectionData>>[]) => {
    const removed = changes.filter((change): change is Extract<typeof change, { type: 'remove' }> => change.type === 'remove').map((change) => change.id);
    if (removed.length > 0) deleteConnections(removed);
    const selectedChanges = changes.filter((change): change is Extract<typeof change, { type: 'select' }> => change.type === 'select');
    if (selectedChanges.length > 0) {
      setSelectedEdgeIds((current) => {
        const next = new Set(current);
        for (const change of selectedChanges) change.selected ? next.add(change.id) : next.delete(change.id);
        return next;
      });
    }
  };
  const positionDraftAt = (current: PlacementDraft, clientX: number, clientY: number) => {
    if (!flow || !containerRef.current) return current;
    const rect = containerRef.current.getBoundingClientRect();
    const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const zoom = flow.getViewport().zoom;
    const [width, height] = placementDimensions(current.kind);
    // The Markdown preview is scaled with the canvas; the web preview stays at
    // a fixed screen size. Convert each preview's visible half-size back to
    // flow coordinates so its centre and the eventual node share the pointer.
    const previewScale = current.kind === 'markdown' ? zoom : 1;
    return { ...current, screenX: clientX - rect.left, screenY: clientY - rect.top, flowX: point.x - width * previewScale / (2 * zoom), flowY: point.y - height * previewScale / (2 * zoom), zoom, hasPointerPosition: true };
  };
  const beginPlacement = (kind: 'markdown' | 'web') => {
    const currentFlow = flowRef.current;
    if (!currentFlow || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = rect.width / 2; const screenY = rect.height / 2;
    const point = currentFlow.screenToFlowPosition({ x: rect.left + screenX, y: rect.top + screenY });
    setDraft({ kind, phase: 'moving', screenX, screenY, flowX: point.x, flowY: point.y, zoom: currentFlow.getViewport().zoom, hasPointerPosition: false, url: '', error: null });
  };
  const beginFrameDrawing = () => {
    setDraft(null);
    setFrameDrawDraft(null);
    freeformLassoDraftRef.current = null;
    setFreeformLassoDraft(null);
    setIsFrameDrawing(true);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 't') beginPlacement('markdown');
      else if (key === 'w') beginPlacement('web');
      else if (key === 'f') beginFrameDrawing();
      else if (key === 'c') events.request({ type: 'set-tool-mode', toolMode: 'connection' });
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
  const onPanePointerMove = (event: MouseEvent | ReactMouseEvent | ReactPointerEvent) => {
    if (!draft || draft.phase !== 'moving') return;
    setDraft((current) => current && current.phase === 'moving' ? positionDraftAt(current, event.clientX, event.clientY) : current);
  };
  const createMarkdownAt = (flowX: number, flowY: number, options: { itemId?: string; startEditing?: boolean; select?: boolean; connectionOrigin?: MarkdownConnectionOrigin; placementUpdates?: readonly Placement[] } = {}) => {
    const now = new Date().toISOString(); const id = options.itemId ?? crypto.randomUUID();
    const createItem = { id: crypto.randomUUID(), projectId: document.projectId, createdAt: now, actor: 'user' as const, type: 'create-item' as const, item: { id, kind: 'markdown' as const, title: '未命名文本', summary: '', markdown: '', createdAt: now, updatedAt: now }, placement: { itemId: id, x: flowX, y: flowY, width: DEFAULT_NODE_DIMENSIONS.markdown[0], height: DEFAULT_NODE_DIMENSIONS.markdown[1], zIndex: highestZIndex(document) + 1 } };
    if (options.connectionOrigin) {
      history.executeBatch([
        createItem,
        {
          id: crypto.randomUUID(), projectId: document.projectId, createdAt: now, actor: 'user', type: 'create-connection',
          connection: (() => {
            const source = connectionPointForPlacement(document.placements.get(options.connectionOrigin.sourceItemId)!, options.connectionOrigin.sourceHandle);
            const target = connectionPointForPlacement({ itemId: id, x: flowX, y: flowY, width: DEFAULT_NODE_DIMENSIONS.markdown[0], height: DEFAULT_NODE_DIMENSIONS.markdown[1], zIndex: highestZIndex(document) + 1 }, options.connectionOrigin.targetHandle);
            return {
            id: crypto.randomUUID(), sourceItemId: options.connectionOrigin.sourceItemId, sourceHandle: options.connectionOrigin.sourceHandle,
            sourceX: source.x, sourceY: source.y,
            targetItemId: id, targetHandle: options.connectionOrigin.targetHandle,
            targetX: target.x, targetY: target.y,
            ...DEFAULT_CONNECTION_STYLE,
          }; })(),
        },
        ...(options.placementUpdates && options.placementUpdates.length > 0 ? [{ id: crypto.randomUUID(), projectId: document.projectId, createdAt: now, actor: 'user' as const, type: 'set-placements' as const, placements: [...options.placementUpdates] }] : []),
      ]);
    } else history.execute(createItem);
    if (options.startEditing) {
      setStartEditingItemId(id);
    }
    if (options.startEditing || options.select) {
      events.request({ type: 'select-items', itemIds: [id] });
    }
  };
  const createMarkdownAtDraft = (current: PlacementDraft) => {
    createMarkdownAt(current.flowX, current.flowY);
    setDraft(null);
  };
  const createDirectionalMarkdown = (direction: DirectionalMarkdownKey): boolean => {
    const selectedItemIds = interaction.snapshot.selectedItemIds;
    if (selectedItemIds.length !== 1) return false;
    const selectedItem = document.items.get(selectedItemIds[0]!);
    const selectedPlacement = document.placements.get(selectedItemIds[0]!);
    if (!selectedItem || selectedItem.kind === 'frame' || !selectedPlacement) return false;
    const handles = getDirectionalConnectionHandles(direction);
    const directionalChildren = [...document.connections.values()]
      .filter((connection) => connection.sourceItemId === selectedItem.id && connection.sourceHandle === handles.sourceHandle)
      .map((connection) => connection.targetItemId ? document.placements.get(connection.targetItemId) : undefined)
      .filter((placement): placement is Placement => Boolean(placement))
      .sort((left, right) => (direction === 'ArrowLeft' || direction === 'ArrowRight' ? left.y - right.y || left.itemId.localeCompare(right.itemId) : left.x - right.x || left.itemId.localeCompare(right.itemId)));
    const id = crypto.randomUUID();
    const treePlacements = directionalChildren.length === 0 ? [] : getDirectionalTreePlacements(
      selectedPlacement,
      [...directionalChildren.map((placement) => ({ itemId: placement.itemId, width: placement.width, height: placement.height })), { itemId: id, width: DEFAULT_NODE_DIMENSIONS.markdown[0], height: DEFAULT_NODE_DIMENSIONS.markdown[1] }],
      direction,
    );
    const position = treePlacements.find((placement) => placement.itemId === id) ?? getDirectionalMarkdownPlacement(selectedPlacement, direction);
    const placementUpdates = treePlacements.filter((placement) => placement.itemId !== id).map((placement) => ({ ...document.placements.get(placement.itemId)!, x: placement.x, y: placement.y }));
    // This route deliberately selects the new node without setting
    // startEditingItemId: Cmd/Ctrl+Arrow is a spatial creation shortcut, not
    // an instruction to focus the embedded Markdown editor.
    createMarkdownAt(position.x, position.y, { itemId: id, select: true, connectionOrigin: { sourceItemId: selectedItem.id, ...handles }, placementUpdates });
    return true;
  };
  const createFrameAt = (current: FrameDrawDraft) => {
    const x = Math.min(current.startFlow.x, current.currentFlow.x);
    const y = Math.min(current.startFlow.y, current.currentFlow.y);
    const width = Math.abs(current.currentFlow.x - current.startFlow.x);
    const height = Math.abs(current.currentFlow.y - current.startFlow.y);
    if (width <= 0 || height <= 0) return;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    history.execute({
      id: crypto.randomUUID(),
      projectId: document.projectId,
      createdAt: now,
      actor: 'user',
      type: 'create-item',
      item: { id, kind: 'frame', title: '未命名组', summary: '', description: '', color: '#eef0ff', createdAt: now, updatedAt: now },
      placement: { itemId: id, x, y, width, height, zIndex: lowestZIndex(document) - 1 },
    });
  };
  const toFrameDrawPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!flow || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      flow: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      screen: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    };
  };
  const onCanvasPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isConnectionTool && event.button === 0 && isConnectionDrawTarget(event.target)) {
      const endpoint = connectionEndpointAtScreen(event.clientX, event.clientY, flowRef.current, connectionPlacements, canvasDropTargetAt(event.clientX, event.clientY));
      if (!endpoint) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      setConnectionDrawDraft({ pointerId: event.pointerId, source: endpoint, target: endpoint });
      return;
    }
    const shouldStartFreeformLasso = isPointerTool && event.altKey;
    if (shouldStartFreeformLasso && !freeformLassoDraftRef.current && event.button === 0 && isCanvasPaneTarget(event.target)) {
      const point = toContainerPoint(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const draft = { pointerId: event.pointerId, points: [point] };
      freeformLassoDraftRef.current = draft;
      setFreeformLassoDraft(draft);
      return;
    }
    if (!isFrameDrawing || frameDrawDraft || event.button !== 0 || !isCanvasPaneTarget(event.target)) return;
    const point = toFrameDrawPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setFrameDrawDraft({ pointerId: event.pointerId, startFlow: point.flow, currentFlow: point.flow, startScreen: point.screen, currentScreen: point.screen });
  };
  const onCanvasPointerMoveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (connectionDrawDraft?.pointerId === event.pointerId) {
      const endpoint = connectionEndpointAt(event, flowRef.current, connectionPlacements);
      if (!endpoint) return;
      event.preventDefault();
      event.stopPropagation();
      setConnectionDrawDraft((current) => current?.pointerId === event.pointerId ? { ...current, target: endpoint } : current);
      return;
    }
    if (freeformLassoDraftRef.current?.pointerId === event.pointerId) {
      const point = toContainerPoint(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      const current = freeformLassoDraftRef.current;
      if (!current) return;
      const previous = current.points.at(-1);
      if (!previous || squaredDistance(previous, point) >= 9) {
        const next = { ...current, points: [...current.points, point] };
        freeformLassoDraftRef.current = next;
        setFreeformLassoDraft(next);
      }
      return;
    }
    if (frameDrawDraft?.pointerId === event.pointerId) {
      const point = toFrameDrawPoint(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      setFrameDrawDraft((current) => current?.pointerId === event.pointerId ? { ...current, currentFlow: point.flow, currentScreen: point.screen } : current);
      return;
    }
    if (event.target instanceof Element && event.target.closest('.react-flow')) onPanePointerMove(event);
  };
  const onCanvasPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (connectionDrawDraft?.pointerId === event.pointerId) {
      const endpoint = connectionEndpointAtScreen(event.clientX, event.clientY, flowRef.current, connectionPlacements, canvasDropTargetAt(event.clientX, event.clientY)) ?? connectionDrawDraft.target;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setConnectionDrawDraft(null);
      if (squaredDistance(connectionDrawDraft.source, endpoint) < 9) return;
      const connection: CanvasConnection = {
        id: crypto.randomUUID(),
        sourceItemId: connectionDrawDraft.source.itemId, sourceHandle: connectionDrawDraft.source.handle,
        sourceX: connectionDrawDraft.source.x, sourceY: connectionDrawDraft.source.y,
        targetItemId: endpoint.itemId, targetHandle: endpoint.handle,
        targetX: endpoint.x, targetY: endpoint.y,
        ...DEFAULT_CONNECTION_STYLE,
      };
      history.execute({ ...commandBase(document.projectId), type: 'create-connection', connection });
      setSelectedEdgeIds(new Set([connection.id]));
      // A completed line is immediately selectable and editable, so return to
      // the pointer tool after each creation.
      events.request({ type: 'set-tool-mode', toolMode: 'pointer' });
      return;
    }
    if (freeformLassoDraftRef.current?.pointerId === event.pointerId) {
      const point = toContainerPoint(event);
      const current = freeformLassoDraftRef.current;
      if (!current) return;
      const points = point ? [...current.points, point] : current.points;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      freeformLassoDraftRef.current = null;
      setFreeformLassoDraft(null);
      selectNodesInFreeformLasso(points, containerRef.current, interaction, event.shiftKey);
      selectConnectionsInFreeformLasso(points, event.shiftKey);
      return;
    }
    if (frameDrawDraft?.pointerId !== event.pointerId) return;
    const point = toFrameDrawPoint(event);
    const completed = point ? { ...frameDrawDraft, currentFlow: point.flow, currentScreen: point.screen } : frameDrawDraft;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setFrameDrawDraft(null);
    if (Math.abs(completed.currentScreen.x - completed.startScreen.x) >= MIN_FRAME_DRAW_SIZE && Math.abs(completed.currentScreen.y - completed.startScreen.y) >= MIN_FRAME_DRAW_SIZE) {
      createFrameAt(completed);
      setIsFrameDrawing(false);
    }
  };
  const onCanvasDoubleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (interaction.snapshot.toolMode === 'freeform-lasso' || isFrameDrawing || frameDrawDraft || draft || !flow || !isCanvasPaneTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const position = positionDraftAt({ kind: 'markdown', phase: 'moving', screenX: 0, screenY: 0, flowX: 0, flowY: 0, zoom: flow.getViewport().zoom, hasPointerPosition: false, url: '', error: null }, event.clientX, event.clientY);
    createMarkdownAt(position.flowX, position.flowY, { startEditing: true });
  };
  const submitWebDraft = async () => {
    if (!draft || draft.kind !== 'web') return;
    let url: URL;
    try { url = new URL(draft.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); } catch { setDraft((current) => current ? { ...current, error: '请输入不含账号信息的 HTTPS URL。' } : current); return; }
    if (!createWebPreview) { setDraft((current) => current ? { ...current, error: '网页服务尚不可用。' } : current); return; }
    const request = { itemId: crypto.randomUUID(), x: draft.flowX, y: draft.flowY, width: WEB_PREVIEW_PLACEMENT_DIMENSIONS[0], height: WEB_PREVIEW_PLACEMENT_DIMENSIONS[1], zIndex: highestZIndex(document) + 1 };
    // Do not navigate an iframe until CreateWebAsset accepts the URL. This keeps
    // browser-side navigation behind the server's URL validation boundary.
    setDraft({ ...draft, phase: 'saving', url: url.toString(), error: null });
    void createWebPreview(url.toString(), request).then(() => setDraft(null), (error: unknown) => setDraft((current) => current ? { ...current, phase: 'input', error: error instanceof Error ? error.message : '保存网页预览失败。' } : current));
  };
  return (
    <div
      ref={containerRef}
      data-dream-weave-canvas-renderer=""
      data-tool-mode={interaction.snapshot.toolMode}
      data-node-dragging={interaction.snapshot.isDragging}
      data-frame-drawing={isFrameDrawing || frameDrawDraft ? 'true' : 'false'}
      data-freeform-lasso={freeformLassoDraft ? 'true' : 'false'}
      data-connection-drawing={connectionDrawDraft ? 'true' : 'false'}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 320, ...style }}
      tabIndex={0}
      onKeyDown={(event) => {
        const selectedItemIds = interaction.getSelectedItemIds();
        // A directional shortcut can select a just-created node before React
        // commits the document-state update. Read the live document here so a
        // following Enter targets that node instead of the prior selection.
        const selectedItem = selectedItemIds.length === 1 ? documentService.getDocument().items.get(selectedItemIds[0]) : undefined;
        if (event.key === 'Enter' && !isEditableTarget(event.target) && !event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && selectedItem?.kind === 'markdown') {
          event.preventDefault();
          event.stopPropagation();
          setStartEditingItemId(selectedItem.id);
          return;
        }
        if (event.key === 'Backspace' && selectedEdgeIds.size > 0 && !isEditableTarget(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          deleteConnections([...selectedEdgeIds]);
          return;
        }
        if (!isEditableTarget(event.target) && !event.nativeEvent.isComposing && !event.repeat && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey) && isDirectionalMarkdownKey(event.key) && createDirectionalMarkdown(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        interaction.onKeyDown(event);
      }}
      onKeyUp={interaction.onKeyUp}
      onPointerDown={(event) => {
        if (!isEditableTarget(event.target)) event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerDownCapture={onCanvasPointerDownCapture}
      onPointerMoveCapture={onCanvasPointerMoveCapture}
      onPointerUpCapture={onCanvasPointerUpCapture}
      onDoubleClickCapture={onCanvasDoubleClickCapture}
    >
      <ReactFlow<CanvasFlowNode, Edge<CanvasConnectionData>>
        nodes={interaction.flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={CanvasConnectionLine}
        onNodesChange={interaction.onNodesChange}
        onNodeClick={(event) => {
          if (!event.shiftKey) setSelectedEdgeIds(new Set());
        }}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={(_event, node, selectedNodes) => interaction.onNodeDragStart(selectedNodes.length > 0 ? selectedNodes : [node])}
        onNodeDragStop={(_event, node, selectedNodes) => {
          interaction.onNodeDragStop(selectedNodes.length > 0 ? selectedNodes : [node]);
          const after = documentService.getDocument();
          const updates = [...after.connections.values()].flatMap((connection) => {
            const anchored = anchorConnectionToPlacements(connection, connectionPlacements);
            if (anchored.sourceX === connection.sourceX && anchored.sourceY === connection.sourceY && anchored.targetX === connection.targetX && anchored.targetY === connection.targetY && anchored.sourceHandle === connection.sourceHandle && anchored.targetHandle === connection.targetHandle) return [];
            return [{ ...commandBase(after.projectId), type: 'update-connection' as const, connection: anchored }];
          });
          if (updates.length > 0) history.executeBatch(updates);
        }}
        onSelectionChange={({ nodes: selectedNodes }) => interaction.onSelectionChange(selectedNodes)}
        onSelectionStart={(event) => {
          if (!isPointerTool) return;
          rectangleLassoStartRef.current = { x: event.clientX, y: event.clientY, append: event.shiftKey };
        }}
        onSelectionEnd={(event) => {
          const start = rectangleLassoStartRef.current;
          rectangleLassoStartRef.current = null;
          if (start && isPointerTool) selectConnectionsInRectangle(start, { x: event.clientX, y: event.clientY }, start.append);
        }}
        onMove={(_event, viewport) => interaction.onMove(viewport)}
        onInit={(instance) => { interaction.onInit(instance); setFlow(instance); }}
        onPaneContextMenu={(event) => event.preventDefault()}
        onPaneMouseMove={onPanePointerMove}
        onPaneClick={(event) => {
          if (isPointerTool) setSelectedEdgeIds(new Set());
          if (isFrameDrawing || frameDrawDraft) return;
          if (draft?.phase !== 'moving') return;
          const positionedDraft = positionDraftAt(draft, event.clientX, event.clientY);
          if (positionedDraft.kind === 'markdown') createMarkdownAtDraft(positionedDraft);
          else setDraft({ ...positionedDraft, phase: 'input' });
        }}
        nodesDraggable={isPointerTool}
        elevateNodesOnSelect={false}
        nodeDragThreshold={3}
        nodesConnectable={false}
        elementsSelectable={isPointerTool}
        selectionOnDrag={isPointerTool}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        panOnDrag={isPointerTool ? POINTER_PAN_BUTTONS : true}
        panOnScroll
        panOnScrollSpeed={0.5}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={3}
        panOnScrollMode={PanOnScrollMode.Free}
        fitView={fitInitialDocument}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <CanvasViewportRadar nodes={interaction.flowNodes} viewport={interaction.snapshot.viewport} containerSize={containerSize} />
      </ReactFlow>
      <CanvasFloatingConnections
        connections={[...document.connections.values()]}
        placements={connectionPlacements}
        draft={connectionDrawDraft}
        viewport={interaction.snapshot.viewport}
        selectedConnectionIds={selectedEdgeIds}
        onSelect={(connectionId) => setSelectedEdgeIds(new Set([connectionId]))}
        onUpdate={updateConnectionStyle}
        onDelete={(connectionId) => deleteConnections([connectionId])}
        endpointDrag={connectionEndpointDrag}
        onEndpointDragStart={beginConnectionEndpointDrag}
        onEndpointDragMove={moveConnectionEndpointDrag}
        onEndpointDragEnd={finishConnectionEndpointDrag}
      />
      {draft && <CanvasPlacementDraft draft={draft} onCancel={() => setDraft(null)} onUrlChange={(url) => setDraft((current) => current ? { ...current, url, error: null } : current)} onSubmit={() => void submitWebDraft()} />}
      {frameDrawDraft && <CanvasFrameDrawDraft draft={frameDrawDraft} />}
      {freeformLassoDraft && <CanvasFreeformLassoDraft draft={freeformLassoDraft} />}
      <CanvasBottomToolbar assetUpload={assetUpload} onBeginMarkdownPlacement={() => beginPlacement('markdown')} onBeginWebPreviewPlacement={() => beginPlacement('web')} onBeginFrameDrawing={beginFrameDrawing} lassoShape={lassoShape} onLassoShapeChange={setLassoShape} />
    </div>
  );
}

function CanvasFreeformLassoDraft({ draft }: { draft: FreeformLassoDraft }): ReactElement {
  if (draft.points.length < 2) return <svg className="dw-freeform-lasso-draft" aria-hidden="true" />;
  const points = draft.points.map(({ x, y }) => `${x},${y}`).join(' ');
  return <svg className="dw-freeform-lasso-draft" aria-hidden="true"><polygon points={points} /></svg>;
}

function CanvasFrameDrawDraft({ draft }: { draft: FrameDrawDraft }): ReactElement {
  const left = Math.min(draft.startScreen.x, draft.currentScreen.x);
  const top = Math.min(draft.startScreen.y, draft.currentScreen.y);
  const width = Math.abs(draft.currentScreen.x - draft.startScreen.x);
  const height = Math.abs(draft.currentScreen.y - draft.startScreen.y);
  return <div className="dw-frame-draw-draft" style={{ left, top, width, height }} aria-hidden="true"><span># 未命名组</span></div>;
}

function CanvasPlacementDraft({ draft, onCancel, onUrlChange, onSubmit }: { draft: PlacementDraft; onCancel: () => void; onUrlChange: (value: string) => void; onSubmit: () => void }): ReactElement | null {
  const moving = draft.phase === 'moving';
  if (moving && !draft.hasPointerPosition) return null;
  const style = {
    left: draft.screenX,
    top: draft.screenY,
    width: placementDimensions(draft.kind)[0],
    height: placementDimensions(draft.kind)[1],
    transform: draft.kind === 'markdown' && moving ? `translate(-50%, -50%) scale(${draft.zoom})` : 'translate(-50%, -50%)',
    transformOrigin: draft.kind === 'markdown' && moving ? 'center' : undefined,
  };
  return <section className={`dw-placement-draft dw-placement-draft--${draft.kind} ${moving ? 'dw-placement-draft--moving' : ''} nodrag nopan nowheel`} style={style} onPointerDown={moving ? undefined : (event) => event.stopPropagation()}>
    {draft.kind === 'markdown' ? <MarkdownPlacementGhost /> : moving ? <WebPreviewUrlComposer ghost /> : draft.phase === 'saving' ? <><strong>正在创建网页预览</strong><span role="status">正在验证并保存 URL…</span></> : <WebPreviewUrlComposer url={draft.url} error={draft.error} onChange={onUrlChange} onSubmit={onSubmit} />}
    {!moving && draft.phase !== 'saving' && <button type="button" className="dw-placement-draft__cancel" aria-label="取消放置" onClick={onCancel}>×</button>}
  </section>;
}

function placementDimensions(kind: PlacementDraft['kind']): readonly [number, number] {
  return kind === 'markdown' ? DEFAULT_NODE_DIMENSIONS.markdown : WEB_PREVIEW_PLACEMENT_DIMENSIONS;
}

/** Mirrors an empty Product Brief card so placement preview and final node have
 * the same compact geometry without introducing a renderer → node-package cycle. */
function MarkdownPlacementGhost(): ReactElement {
  return <div className="dw-product-brief dw-placement-draft__markdown-ghost" aria-hidden="true">
    <div className="dw-product-brief__header dw-canvas-node-title">
      <svg className="dw-canvas-node-title__icon" viewBox="0 0 24 24"><path d="M14.04 1.001a3.4 3.4 0 0 1 2.371.998l3.586 3.586.116.121A3.4 3.4 0 0 1 21 8v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8zM6 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9h-4a2 2 0 0 1-2-2V3zm10 13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm0-4a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm-6-4a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm5-1h3.584L15 3.416z" /></svg>
      <span className="dw-canvas-node-title__label">文本</span>
    </div>
    <div className="dw-product-brief__surface">
      <div className="dw-product-brief__content"><div className="dw-placement-draft__markdown-placeholder">输入 Markdown，使用 / 插入块</div></div>
    </div>
  </div>;
}

function WebPreviewUrlComposer({ ghost = false, error, onChange, onSubmit, url = '' }: { ghost?: boolean; error?: string | null; onChange?: (value: string) => void; onSubmit?: () => void; url?: string }): ReactElement {
  return <form aria-hidden={ghost || undefined} inert={ghost} onSubmit={(event) => { event.preventDefault(); if (!ghost) onSubmit?.(); }}>
    <label>网页 URL<input autoFocus={!ghost} value={url} placeholder="https://example.com" onChange={(event) => onChange?.(event.target.value)} /></label>
    <button type="submit">立即预览</button>
    {error && <small role="status">{error}</small>}
  </form>;
}

function highestZIndex(document: CanvasDocument): number { return Math.max(-1, ...[...document.placements.values()].map((placement) => placement.zIndex)); }
function lowestZIndex(document: CanvasDocument): number { return Math.min(0, ...[...document.placements.values()].map((placement) => placement.zIndex)); }

function isCanvasPaneTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && !target.closest('.react-flow__node')
    && Boolean(target.closest('.react-flow__pane, .react-flow__background, .react-flow__viewport'));
}

function isConnectionDrawTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest('.dw-bottom-toolbar, .dw-connection-toolbar, .dw-floating-connection-hit, .dw-floating-connection-endpoint, button, input, textarea, select, [contenteditable="true"], iframe');
}

function connectionEndpointAt(event: ReactPointerEvent<HTMLDivElement>, flow: ReactFlowInstance<CanvasFlowNode, Edge<CanvasConnectionData>> | null, placements: ReadonlyMap<string, Placement>): ConnectionEndpoint | null {
  return connectionEndpointAtScreen(event.clientX, event.clientY, flow, placements, event.target);
}

function canvasDropTargetAt(clientX: number, clientY: number): Element | null {
  const elements = globalThis.document.elementsFromPoint(clientX, clientY)
    .filter((element) => !element.closest('.dw-floating-connections, .dw-floating-connection-toolbar-layer'));
  return elements.find((element) => element.closest('.react-flow__node[data-id]')) ?? elements[0] ?? null;
}

function connectionEndpointAtScreen(clientX: number, clientY: number, flow: ReactFlowInstance<CanvasFlowNode, Edge<CanvasConnectionData>> | null, placements: ReadonlyMap<string, Placement>, target: EventTarget | null): ConnectionEndpoint | null {
  if (!flow) return null;
  const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
  const nodeElement = target instanceof Element ? target.closest<HTMLElement>('.react-flow__node[data-id]') : null;
  const itemId = nodeElement?.dataset.id;
  const placement = itemId ? placements.get(itemId) : undefined;
  if (!itemId || !placement) return { x: point.x, y: point.y };
  const distances = {
    left: Math.abs(point.x - placement.x), right: Math.abs(point.x - (placement.x + placement.width)),
    top: Math.abs(point.y - placement.y), bottom: Math.abs(point.y - (placement.y + placement.height)),
  } as const;
  const handle = (Object.entries(distances).sort(([, left], [, right]) => left - right)[0]?.[0] ?? 'right') as ConnectionHandle;
  return { itemId, handle, ...connectionPointForPlacement(placement, handle) };
}

function CanvasFloatingConnections({ connections, placements, draft, viewport, selectedConnectionIds, onSelect, onUpdate, onDelete, endpointDrag, onEndpointDragStart, onEndpointDragMove, onEndpointDragEnd }: {
  connections: readonly CanvasConnection[];
  placements: ReadonlyMap<string, Placement>;
  draft: ConnectionDrawDraft | null;
  viewport: { x: number; y: number; zoom: number };
  selectedConnectionIds: ReadonlySet<string>;
  onSelect: (connectionId: string) => void;
  onUpdate: (connectionId: string, patch: Partial<CanvasConnectionStyle>) => void;
  onDelete: (connectionId: string) => void;
  endpointDrag: ConnectionEndpointDrag | null;
  onEndpointDragStart: (connectionId: string, endpoint: 'source' | 'target', event: ReactPointerEvent<SVGCircleElement>) => void;
  onEndpointDragMove: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onEndpointDragEnd: (event: ReactPointerEvent<SVGCircleElement>) => void;
}): ReactElement {
  const preview: readonly CanvasConnection[] = draft ? [{ id: 'draft', sourceX: draft.source.x, sourceY: draft.source.y, targetX: draft.target.x, targetY: draft.target.y, ...DEFAULT_CONNECTION_STYLE }] : [];
  const renderedConnections = connections.map((connection) => {
    if (endpointDrag?.connectionId !== connection.id) return anchorConnectionToPlacements(connection, placements);
    const detachedEnd = endpointDrag.endpoint === 'source'
      ? { sourceItemId: undefined, sourceHandle: undefined, sourceX: endpointDrag.x, sourceY: endpointDrag.y }
      : { targetItemId: undefined, targetHandle: undefined, targetX: endpointDrag.x, targetY: endpointDrag.y };
    return anchorConnectionToPlacements({ ...connection, ...detachedEnd }, placements);
  });
  return <>
    <svg className="dw-floating-connections" aria-label="画布连线">
      <defs>
        <marker id="dw-floating-connection-arrow" markerWidth="14" markerHeight="14" viewBox="0 0 12 12" refX="9.5" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 6 L 0 12 Z" fill={CONNECTION_COLORS.default} /></marker>
        <marker id="dw-floating-connection-arrow-start" markerWidth="14" markerHeight="14" viewBox="0 0 12 12" refX="9.5" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 6 L 0 12 Z" fill={CONNECTION_COLORS.default} /></marker>
        {(['top', 'right', 'bottom', 'left'] as const).map((handle) => <marker key={handle} id={floatingConnectionAttachmentArrowMarkerId(handle)} markerWidth="14" markerHeight="14" viewBox="0 0 12 12" refX="9.5" refY="6" orient={getConnectionAttachmentArrowOrientation(handle)} markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 6 L 0 12 Z" fill={CONNECTION_COLORS.default} /></marker>)}
      </defs>
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {[...renderedConnections, ...preview].map((connection) => {
          const selected = selectedConnectionIds.has(connection.id);
          const path = floatingConnectionPath(connection);
          const isPreview = connection.id === 'draft';
          return <g key={connection.id}>
            {!isPreview && <path className="dw-floating-connection-hit" d={path} fill="none" stroke="transparent" strokeWidth="16" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(connection.id); }} />}
            <path className={`dw-floating-connection${selected ? ' is-selected' : ''}`} d={path} fill="none" stroke={CONNECTION_COLORS.default} strokeWidth={selected ? '3' : '2'} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={connection.stroke === 'dashed' ? '7 5' : undefined} markerStart={connection.direction === 'both' ? floatingConnectionStartArrowMarker(connection) : undefined} markerEnd={connection.direction === 'forward' || connection.direction === 'both' ? floatingConnectionEndArrowMarker(connection) : undefined} />
            {selected && !isPreview && <>
              <circle className="dw-floating-connection-endpoint" data-end="source" data-item-id={connection.sourceItemId} data-attached={String(Boolean(connection.sourceItemId))} cx={connection.sourceX} cy={connection.sourceY} r="6" onPointerDown={(event) => onEndpointDragStart(connection.id, 'source', event)} onPointerMove={onEndpointDragMove} onPointerUp={onEndpointDragEnd} />
              <circle className="dw-floating-connection-endpoint" data-end="target" data-item-id={connection.targetItemId} data-attached={String(Boolean(connection.targetItemId))} cx={connection.targetX} cy={connection.targetY} r="6" onPointerDown={(event) => onEndpointDragStart(connection.id, 'target', event)} onPointerMove={onEndpointDragMove} onPointerUp={onEndpointDragEnd} />
            </>}
          </g>;
        })}
      </g>
    </svg>
    {renderedConnections.filter((connection) => selectedConnectionIds.has(connection.id)).map((connection) => {
      const point = floatingConnectionToolbarPoint(connection, viewport);
      return <div key={connection.id} className="dw-floating-connection-toolbar-layer" style={{ left: point.x, top: point.y }}>
        <CanvasConnectionToolbar style={connection} x={0} y={0} onUpdate={(patch) => onUpdate(connection.id, patch)} onDelete={() => onDelete(connection.id)} />
      </div>;
    })}
  </>;
}

function floatingConnectionAttachmentArrowMarkerId(handle: ConnectionHandle): string {
  return `dw-floating-connection-arrow-attached-${handle}`;
}

function floatingConnectionStartArrowMarker(connection: Pick<CanvasConnection, 'sourceHandle'>): string {
  const markerId = connection.sourceHandle ? floatingConnectionAttachmentArrowMarkerId(connection.sourceHandle) : 'dw-floating-connection-arrow-start';
  return `url(#${markerId})`;
}

function floatingConnectionEndArrowMarker(connection: Pick<CanvasConnection, 'targetHandle'>): string {
  const markerId = connection.targetHandle ? floatingConnectionAttachmentArrowMarkerId(connection.targetHandle) : 'dw-floating-connection-arrow';
  return `url(#${markerId})`;
}

function floatingConnectionPath(connection: Pick<CanvasConnection, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourceHandle' | 'targetHandle' | 'shape'>): string {
  if (connection.shape === 'straight') return `M ${connection.sourceX} ${connection.sourceY} L ${connection.targetX} ${connection.targetY}`;
  if (connection.shape === 'elbow') return `M ${connection.sourceX} ${connection.sourceY} L ${(connection.sourceX + connection.targetX) / 2} ${connection.sourceY} L ${(connection.sourceX + connection.targetX) / 2} ${connection.targetY} L ${connection.targetX} ${connection.targetY}`;
  const distance = Math.max(80, Math.hypot(connection.targetX - connection.sourceX, connection.targetY - connection.sourceY) / 3);
  const sourceTangent = connectionHandleTangent(connection.sourceHandle, connection.targetX - connection.sourceX, connection.targetY - connection.sourceY);
  const targetTangent = connectionHandleTangent(connection.targetHandle, connection.sourceX - connection.targetX, connection.sourceY - connection.targetY);
  return `M ${connection.sourceX} ${connection.sourceY} C ${connection.sourceX + sourceTangent.x * distance} ${connection.sourceY + sourceTangent.y * distance}, ${connection.targetX + targetTangent.x * distance} ${connection.targetY + targetTangent.y * distance}, ${connection.targetX} ${connection.targetY}`;
}

function floatingConnectionToolbarPoint(connection: CanvasConnection, viewport: { x: number; y: number; zoom: number }): { x: number; y: number } {
  return {
    x: (connection.sourceX + connection.targetX) / 2 * viewport.zoom + viewport.x,
    y: (connection.sourceY + connection.targetY) / 2 * viewport.zoom + viewport.y,
  };
}

function connectionPointForPlacement(placement: Placement, handle: ConnectionHandle): { x: number; y: number } {
  const x = handle === 'left' ? placement.x : handle === 'right' ? placement.x + placement.width : placement.x + placement.width / 2;
  const y = handle === 'top' ? placement.y : handle === 'bottom' ? placement.y + placement.height : placement.y + placement.height / 2;
  return { x, y };
}

function connectionHandleTangent(handle: ConnectionHandle | undefined, fallbackX: number, fallbackY: number): { x: number; y: number } {
  if (handle === 'top') return { x: 0, y: -1 };
  if (handle === 'right') return { x: 1, y: 0 };
  if (handle === 'bottom') return { x: 0, y: 1 };
  if (handle === 'left') return { x: -1, y: 0 };
  const length = Math.hypot(fallbackX, fallbackY) || 1;
  return { x: fallbackX / length, y: fallbackY / length };
}

/** BlockSuite-equivalent automatic anchor selection: choose the closest side again whenever a node moves. */
export function getNearestConnectionHandle(placement: Placement, point: { x: number; y: number }): ConnectionHandle {
  return (['top', 'right', 'bottom', 'left'] as const)
    .map((handle) => ({ handle, point: connectionPointForPlacement(placement, handle) }))
    .sort((left, right) => squaredDistance(left.point, point) - squaredDistance(right.point, point))[0]!.handle;
}

function placementCenter(placement: Placement): { x: number; y: number } {
  return { x: placement.x + placement.width / 2, y: placement.y + placement.height / 2 };
}

export function anchorConnectionToPlacements(connection: CanvasConnection, placements: ReadonlyMap<string, Placement>): CanvasConnection {
  const sourcePlacement = connection.sourceItemId ? placements.get(connection.sourceItemId) : undefined;
  const targetPlacement = connection.targetItemId ? placements.get(connection.targetItemId) : undefined;
  const sourceHandle = sourcePlacement ? getNearestConnectionHandle(sourcePlacement, targetPlacement ? placementCenter(targetPlacement) : { x: connection.targetX, y: connection.targetY }) : undefined;
  const targetHandle = targetPlacement ? getNearestConnectionHandle(targetPlacement, sourcePlacement ? placementCenter(sourcePlacement) : { x: connection.sourceX, y: connection.sourceY }) : undefined;
  const sourcePoint = sourcePlacement && sourceHandle ? connectionPointForPlacement(sourcePlacement, sourceHandle) : undefined;
  const targetPoint = targetPlacement && targetHandle ? connectionPointForPlacement(targetPlacement, targetHandle) : undefined;
  return {
    ...connection,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
    ...(sourcePoint ? { sourceX: sourcePoint.x, sourceY: sourcePoint.y } : {}),
    ...(targetPoint ? { targetX: targetPoint.x, targetY: targetPoint.y } : {}),
  };
}

function samePlacements(left: ReadonlyMap<string, Placement>, right: ReadonlyMap<string, Placement>): boolean {
  if (left.size !== right.size) return false;
  for (const [itemId, placement] of left) {
    const other = right.get(itemId);
    if (!other || Math.abs(placement.x - other.x) > .1 || Math.abs(placement.y - other.y) > .1 || Math.abs(placement.width - other.width) > .1 || Math.abs(placement.height - other.height) > .1) return false;
  }
  return true;
}

function connectionIntersectsRectangle(connection: CanvasConnection, rectangle: { left: number; top: number; right: number; bottom: number }): boolean {
  const points = connectionPolyline(connection);
  return points.some((point) => point.x >= rectangle.left && point.x <= rectangle.right && point.y >= rectangle.top && point.y <= rectangle.bottom)
    || points.some((point, index) => index > 0 && segmentIntersectsRectangle(points[index - 1]!, point, rectangle));
}

function connectionIntersectsPolygon(connection: CanvasConnection, polygon: readonly { x: number; y: number }[]): boolean {
  const points = connectionPolyline(connection);
  const polygonEdges = polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!] as const);
  return points.some((point) => pointInPolygon(point, polygon))
    || points.some((point, index) => index > 0 && polygonEdges.some(([start, end]) => segmentsIntersect(points[index - 1]!, point, start, end)));
}

function connectionPolyline(connection: CanvasConnection): { x: number; y: number }[] {
  if (connection.shape === 'straight') return [{ x: connection.sourceX, y: connection.sourceY }, { x: connection.targetX, y: connection.targetY }];
  if (connection.shape === 'elbow') {
    const middleX = (connection.sourceX + connection.targetX) / 2;
    return [{ x: connection.sourceX, y: connection.sourceY }, { x: middleX, y: connection.sourceY }, { x: middleX, y: connection.targetY }, { x: connection.targetX, y: connection.targetY }];
  }
  const distance = Math.max(40, Math.abs(connection.targetX - connection.sourceX) * .45);
  const controlOne = { x: connection.sourceX + distance, y: connection.sourceY };
  const controlTwo = { x: connection.targetX - distance, y: connection.targetY };
  return Array.from({ length: 25 }, (_, index) => cubicBezierPoint(
    { x: connection.sourceX, y: connection.sourceY }, controlOne, controlTwo, { x: connection.targetX, y: connection.targetY }, index / 24,
  ));
}

function cubicBezierPoint(start: { x: number; y: number }, controlOne: { x: number; y: number }, controlTwo: { x: number; y: number }, end: { x: number; y: number }, t: number): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlOne.x + 3 * inverse * t ** 2 * controlTwo.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlOne.y + 3 * inverse * t ** 2 * controlTwo.y + t ** 3 * end.y,
  };
}

function segmentIntersectsRectangle(start: { x: number; y: number }, end: { x: number; y: number }, rectangle: { left: number; top: number; right: number; bottom: number }): boolean {
  if (start.x >= rectangle.left && start.x <= rectangle.right && start.y >= rectangle.top && start.y <= rectangle.bottom) return true;
  const corners = [{ x: rectangle.left, y: rectangle.top }, { x: rectangle.right, y: rectangle.top }, { x: rectangle.right, y: rectangle.bottom }, { x: rectangle.left, y: rectangle.bottom }];
  return corners.some((corner, index) => segmentsIntersect(start, end, corner, corners[(index + 1) % corners.length]!));
}

function toContainerPoint(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  return Number.isFinite(rect.left) && Number.isFinite(rect.top) ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null;
}

function selectNodesInFreeformLasso(points: readonly { x: number; y: number }[], container: HTMLDivElement | null, interaction: { readonly snapshot: { readonly selectedItemIds: readonly string[] }; readonly flowNodes: readonly CanvasFlowNode[]; onSelectionChange(nodes: readonly CanvasFlowNode[]): void; applySelection(nodes: readonly CanvasFlowNode[]): void }, append: boolean): void {
  if (!container || points.length < 3) return;
  const containerRect = container.getBoundingClientRect();
  const selectedIds = new Set(append ? interaction.snapshot.selectedItemIds : []);
  for (const node of interaction.flowNodes) {
    const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const nodeRect = { left: rect.left - containerRect.left, top: rect.top - containerRect.top, right: rect.right - containerRect.left, bottom: rect.bottom - containerRect.top };
    if (polygonIntersectsRectangle(points, nodeRect)) selectedIds.add(node.id);
  }
  const selectedNodes = interaction.flowNodes.filter((node) => selectedIds.has(node.id));
  interaction.applySelection(selectedNodes);
  interaction.onSelectionChange(selectedNodes);
}

function polygonIntersectsRectangle(points: readonly { x: number; y: number }[], rect: { left: number; top: number; right: number; bottom: number }): boolean {
  const corners = [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }];
  if (corners.some((corner) => pointInPolygon(corner, points)) || points.some((point) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) return true;
  const rectangleEdges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]] as const);
  return points.some((point, index) => rectangleEdges.some(([start, end]) => segmentsIntersect(point, points[(index + 1) % points.length], start, end)));
}

function pointInPolygon(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]; const before = polygon[previous];
    if ((current.y > point.y) !== (before.y > point.y) && point.x < (before.x - current.x) * (point.y - current.y) / (before.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const direction = (first: typeof a, second: typeof a, third: typeof a) => (third.x - first.x) * (second.y - first.y) - (third.y - first.y) * (second.x - first.x);
  const first = direction(a, b, c); const second = direction(a, b, d); const third = direction(c, d, a); const fourth = direction(c, d, b);
  return ((first > 0 && second < 0) || (first < 0 && second > 0)) && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0));
}

function squaredDistance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

function commandBase(projectId: string): { id: string; projectId: string; createdAt: string; actor: 'user' } {
  return { id: crypto.randomUUID(), projectId, createdAt: new Date().toISOString(), actor: 'user' };
}

function isConnectionHandle(value: string): value is ConnectionHandle {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function useElementSize(elementRef: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef]);

  return size;
}
