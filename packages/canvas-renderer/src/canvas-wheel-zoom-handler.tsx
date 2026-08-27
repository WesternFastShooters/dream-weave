import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import { useEffect, useRef } from 'react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

/**
 * Owns browser zoom gestures for the entire document while a canvas is mounted.
 *
 * macOS Chromium exposes a trackpad pinch as Ctrl + wheel. We must prevent that
 * browser-level default regardless of where the gesture starts; otherwise a
 * control inside the canvas can zoom the page before React Flow sees the event.
 * Only an unadorned React Flow pane is allowed to turn the gesture into a canvas
 * zoom. Keeping this capture-phase boundary here avoids requiring every canvas
 * control to add its own wheel-event guard.
 */
export function useCanvasWheelZoom<TNode extends Node, TEdge extends Edge = Edge>(
  containerRef: React.RefObject<HTMLElement | null>,
  flow: ReactFlowInstance<TNode, TEdge> | null,
): void {
  const pendingDeltaRef = useRef(0);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!flow) return;

    const flush = () => {
      frameRef.current = null;
      const container = containerRef.current;
      const pointer = pendingPointerRef.current;
      const delta = pendingDeltaRef.current;
      pendingPointerRef.current = null;
      pendingDeltaRef.current = 0;
      if (!container || !pointer || delta === 0) return;

      const rect = container.getBoundingClientRect();
      const current = flow.getViewport();
      const zoom = clampZoom(current.zoom * 2 ** delta);
      if (zoom === current.zoom) return;

      const flowX = (pointer.x - rect.left - current.x) / current.zoom;
      const flowY = (pointer.y - rect.top - current.y) / current.zoom;
      void flow.setViewport({
        x: pointer.x - rect.left - flowX * zoom,
        y: pointer.y - rect.top - flowY * zoom,
        zoom,
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const container = containerRef.current;

      // This listener is the single browser-zoom boundary for the app. Stop
      // React Flow's scroll handler as well: UI controls must not pan or zoom
      // the canvas when the same gesture is used on them.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!container || !isCanvasZoomSurface(event.target, container)) return;

      pendingDeltaRef.current += normalizeWheelDelta(event);
      pendingPointerRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
    };

    // Safari emits these non-standard gesture events for a native pinch. The
    // wheel handler above covers Chromium; both are registered centrally so
    // canvas controls and outer application chrome share the same policy.
    const preventNativeGestureZoom = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const preventMultiTouchPageZoom = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    document.addEventListener('gesturestart', preventNativeGestureZoom, { capture: true, passive: false });
    document.addEventListener('gesturechange', preventNativeGestureZoom, { capture: true, passive: false });
    document.addEventListener('touchmove', preventMultiTouchPageZoom, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
      document.removeEventListener('gesturestart', preventNativeGestureZoom, { capture: true });
      document.removeEventListener('gesturechange', preventNativeGestureZoom, { capture: true });
      document.removeEventListener('touchmove', preventMultiTouchPageZoom, { capture: true });
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingDeltaRef.current = 0;
      pendingPointerRef.current = null;
    };
  }, [containerRef, flow]);
}

function isCanvasZoomSurface(target: EventTarget | null, container: HTMLElement): boolean {
  if (!(target instanceof Element) || !container.contains(target)) return false;
  if (!target.closest('.react-flow__pane, .react-flow__background')) return false;

  // Nodes, edges and React Flow panels are interactive UI even though they are
  // rendered within the flow tree. `nowheel` keeps this boundary extensible for
  // product controls without giving each control an event listener.
  return !target.closest([
    '.react-flow__node',
    '.react-flow__edge',
    '.react-flow__panel',
    '.react-flow__controls',
    '.react-flow__attribution',
    '.nowheel',
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    'iframe',
  ].join(','));
}

function normalizeWheelDelta(event: WheelEvent): number {
  const multiplier = event.ctrlKey ? 10 : 1;
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * multiplier;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
