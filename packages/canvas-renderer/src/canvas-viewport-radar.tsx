import { ICanvasEventService, type CanvasViewport } from '@dream-weave/canvas-interaction';
import { useService } from '@dream-weave/di';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react';
import type { CanvasFlowNode } from './canvas-node-registry.js';

const RADAR_WIDTH = 168;
const RADAR_HEIGHT = 112;
const RADAR_PADDING = 10;
const MIN_MARK_SIZE = 3;
const MIN_ZOOM_PERCENT = 10;
const MAX_ZOOM_PERCENT = 300;
const FALLBACK_NODE_SIZE = { width: 320, height: 240 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RadarRect extends Rect {
  id: string;
  selected: boolean;
}

interface RadarTransform {
  worldBounds: Rect;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface RadarModel {
  nodeRects: RadarRect[];
  viewportRect: Rect | null;
  transform: RadarTransform;
}

export interface CanvasViewportRadarProps {
  readonly nodes: readonly CanvasFlowNode[];
  readonly viewport: CanvasViewport;
  readonly containerSize: { width: number; height: number };
}

/**
 * Canvas viewport radar. It deliberately draws only generic node
 * rectangles; visual semantics remain owned by product node packages.
 */
export function CanvasViewportRadar({ nodes, viewport, containerSize }: CanvasViewportRadarProps): ReactElement | null {
  const eventService = useService(ICanvasEventService);
  const [inputValue, setInputValue] = useState(() => String(toPercent(viewport.zoom)));
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const model = useMemo(() => buildRadarModel(nodes, viewport, containerSize), [containerSize, nodes, viewport]);
  const isEmpty = model?.nodeRects.length === 0;

  useEffect(() => {
    if (!isEditing) setInputValue(String(toPercent(viewport.zoom)));
  }, [isEditing, viewport.zoom]);

  if (!model) return null;

  const applyZoom = () => {
    const nextPercent = Number.parseInt(inputValue.replace(/%/g, ''), 10);
    if (!isEmpty && Number.isFinite(nextPercent) && nextPercent >= MIN_ZOOM_PERCENT && nextPercent <= MAX_ZOOM_PERCENT) {
      eventService.request({ type: 'zoom-to', zoom: nextPercent / 100 });
    } else {
      setInputValue(String(toPercent(viewport.zoom)));
    }
    setIsEditing(false);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value.replace(/%/g, '');
    if (nextValue === '' || /^\d+$/.test(nextValue)) setInputValue(nextValue);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      applyZoom();
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setInputValue(String(toPercent(viewport.zoom)));
      setIsEditing(false);
      inputRef.current?.blur();
    }
  };

  const onRadarClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isEmpty) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const radarPoint =
      event.detail === 0
        ? { x: RADAR_WIDTH / 2, y: RADAR_HEIGHT / 2 }
        : {
            x: ((event.clientX - bounds.left) / bounds.width) * RADAR_WIDTH,
            y: ((event.clientY - bounds.top) / bounds.height) * RADAR_HEIGHT,
          };
    const point = getFlowPoint(model, radarPoint);
    if (point) eventService.request({ type: 'center-on-point', point });
  };

  return (
    <div className="dream-weave-canvas-radar">
      <button type="button" className="dream-weave-canvas-radar__map" aria-label="定位" onClick={onRadarClick} disabled={isEmpty}>
        <svg viewBox={`0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`} role="presentation">
          <rect x="0.5" y="0.5" width={RADAR_WIDTH - 1} height={RADAR_HEIGHT - 1} rx="8" fill="transparent" />
          {model.nodeRects.map((rect) => (
            <rect
              key={rect.id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx="1.5"
              fill={rect.selected ? '#88b5ff' : '#b4b4be'}
              stroke={rect.selected ? '#669ce7' : 'transparent'}
              strokeWidth={rect.selected ? 1.5 : 0}
            />
          ))}
          {model.viewportRect ? (
            <rect
              x={model.viewportRect.x}
              y={model.viewportRect.y}
              width={model.viewportRect.width}
              height={model.viewportRect.height}
              rx="3"
              fill="rgb(240 240 244 / 0.72)"
              stroke="rgb(99 99 110 / 0.52)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          ) : null}
        </svg>
      </button>
      <div className="dream-weave-canvas-radar__controls">
        <button
          type="button"
          className="dream-weave-canvas-radar__locate"
          aria-label="定位"
          onClick={() => eventService.request({ type: 'fit-view' })}
          disabled={isEmpty}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2 12h3M19 12h3M12 2v3M12 19v3M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14" />
          </svg>
        </button>
        <span aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label="缩放级别"
          type="text"
          value={isEditing ? inputValue : `${inputValue}%`}
          onChange={onInputChange}
          onFocus={() => {
            if (isEmpty) return;
            setIsEditing(true);
            inputRef.current?.select();
          }}
          onBlur={applyZoom}
          onKeyDown={onInputKeyDown}
          disabled={isEmpty}
        />
      </div>
    </div>
  );
}

function buildRadarModel(nodes: readonly CanvasFlowNode[], viewport: CanvasViewport, containerSize: { width: number; height: number }): RadarModel | null {
  if (containerSize.width <= 0 || containerSize.height <= 0 || viewport.zoom <= 0) return null;
  const viewportRect: Rect = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: containerSize.width / viewport.zoom,
    height: containerSize.height / viewport.zoom,
  };
  const sourceRects = nodes.filter((node) => !node.hidden).map((node) => {
    const position = node.position;
    const size = getNodeSize(node);
    return { id: node.id, selected: Boolean(node.selected), x: position.x, y: position.y, width: size.width, height: size.height };
  });
  const worldBounds = sourceRects.reduce<Rect>((bounds, rect) => unionRect(bounds, rect), viewportRect);
  const transform = getTransform(worldBounds);
  return {
    nodeRects: sourceRects.map((rect) => ({ ...rect, ...mapRect(rect, transform) })),
    viewportRect: mapRect(viewportRect, transform),
    transform,
  };
}

function getNodeSize(node: CanvasFlowNode): { width: number; height: number } {
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  return {
    width: sizeValue(style?.width) ?? sizeValue(node.measured?.width) ?? FALLBACK_NODE_SIZE.width,
    height: sizeValue(style?.height) ?? sizeValue(node.measured?.height) ?? FALLBACK_NODE_SIZE.height,
  };
}

function sizeValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unionRect(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return { x, y, width: Math.max(left.x + left.width, right.x + right.width) - x, height: Math.max(left.y + left.height, right.y + right.height) - y };
}

function getTransform(worldBounds: Rect): RadarTransform {
  const drawableWidth = RADAR_WIDTH - RADAR_PADDING * 2;
  const drawableHeight = RADAR_HEIGHT - RADAR_PADDING * 2;
  const scale = Math.min(drawableWidth / Math.max(worldBounds.width, 1), drawableHeight / Math.max(worldBounds.height, 1));
  return {
    worldBounds,
    scale,
    offsetX: RADAR_PADDING + (drawableWidth - worldBounds.width * scale) / 2,
    offsetY: RADAR_PADDING + (drawableHeight - worldBounds.height * scale) / 2,
  };
}

function mapRect(rect: Rect, transform: RadarTransform): Rect {
  return {
    x: transform.offsetX + (rect.x - transform.worldBounds.x) * transform.scale,
    y: transform.offsetY + (rect.y - transform.worldBounds.y) * transform.scale,
    width: Math.max(rect.width * transform.scale, MIN_MARK_SIZE),
    height: Math.max(rect.height * transform.scale, MIN_MARK_SIZE),
  };
}

function getFlowPoint(model: RadarModel, point: { x: number; y: number }): { x: number; y: number } | null {
  const { worldBounds, scale, offsetX, offsetY } = model.transform;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const x = Math.max(offsetX, Math.min(point.x, offsetX + worldBounds.width * scale));
  const y = Math.max(offsetY, Math.min(point.y, offsetY + worldBounds.height * scale));
  return { x: worldBounds.x + (x - offsetX) / scale, y: worldBounds.y + (y - offsetY) / scale };
}

function toPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
