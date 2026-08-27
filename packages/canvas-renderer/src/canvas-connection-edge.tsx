import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';
import type { ConnectionDirection, ConnectionHandle, ConnectionShape, ConnectionStroke } from '@dream-weave/canvas-core';
import { useState, type ReactElement } from 'react';

export type CanvasConnectionShape = ConnectionShape;
export type CanvasConnectionStroke = ConnectionStroke;
export type CanvasConnectionDirection = ConnectionDirection;

export interface CanvasConnectionStyle {
  readonly shape: CanvasConnectionShape;
  readonly stroke: CanvasConnectionStroke;
  readonly direction: CanvasConnectionDirection;
}

export interface CanvasConnectionData extends CanvasConnectionStyle {
  readonly [key: string]: unknown;
  readonly onUpdate?: (edgeId: string, patch: Partial<CanvasConnectionStyle>) => void;
  readonly onDelete?: (edgeId: string) => void;
}

export const DEFAULT_CONNECTION_STYLE: CanvasConnectionStyle = {
  shape: 'curve',
  stroke: 'solid',
  direction: 'forward',
};

export const CONNECTION_COLORS = {
  default: '#526074',
  selected: '#526074',
  selectedShadow: '#344258',
} as const;

/**
 * A marker graphic faces right at 0°.  When it lands on a node, point it
 * inwards through that node border instead of along the curve tangent.
 */
export function getConnectionAttachmentArrowOrientation(handle: ConnectionHandle): number {
  return { top: 90, right: 180, bottom: 270, left: 0 }[handle];
}

type CanvasConnectionPathInput = Pick<EdgeProps, 'sourceX' | 'sourceY' | 'sourcePosition' | 'targetX' | 'targetY' | 'targetPosition'>;
type CanvasConnectionPath = ReturnType<typeof getBezierPath>;

/** Returns the path shared by a completed connection and its drag preview. */
export function getCanvasConnectionPath(input: CanvasConnectionPathInput, shape: CanvasConnectionShape): CanvasConnectionPath {
  return shape === 'straight'
    ? getStraightPath(input)
    : shape === 'elbow'
      ? getSmoothStepPath({ ...input, borderRadius: 12 })
      : getBezierPath(input);
}

/**
 * React Flow's stock connection preview uses its own thin, light-grey stroke.
 * Render it ourselves so an in-progress line has the exact same curve, weight,
 * and colour as a completed default connection.
 */
export function CanvasConnectionLine({ fromX, fromY, fromPosition, toX, toY, toPosition }: ConnectionLineComponentProps): ReactElement {
  const [path] = getCanvasConnectionPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  }, 'curve');
  const markerId = 'dw-connection-preview-arrow';
  return <>
    <defs>
      <marker id={markerId} markerWidth="14" markerHeight="14" viewBox="0 0 12 12" refX="9.5" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 Z" fill={CONNECTION_COLORS.default} />
      </marker>
    </defs>
    <path className="dw-connection-preview" d={path} fill="none" stroke={CONNECTION_COLORS.default} strokeWidth={2} strokeLinecap="round" markerEnd={`url(#${markerId})`} />
  </>;
}

/** Shared 2px connection rendering, calibrated against BlockSuite's default. */
export function CanvasConnectionEdge(props: EdgeProps): ReactElement {
  const data = { ...DEFAULT_CONNECTION_STYLE, ...(props.data as CanvasConnectionData | undefined) };
  const [path, labelX, labelY] = getCanvasConnectionPath(props, data.shape);
  const color = props.selected ? CONNECTION_COLORS.selected : CONNECTION_COLORS.default;
  const markerId = `dw-connection-arrow-${props.id}`;
  const selectionFilterId = `dw-connection-selection-${props.id}`;
  const selectionFilterBounds = {
    x: Math.min(props.sourceX, props.targetX) - 32,
    y: Math.min(props.sourceY, props.targetY) - 32,
    width: Math.abs(props.targetX - props.sourceX) + 64,
    height: Math.abs(props.targetY - props.sourceY) + 64,
  };
  const update = (patch: Partial<CanvasConnectionStyle>) => data.onUpdate?.(props.id, patch);
  const remove = () => data.onDelete?.(props.id);

  return <>
    <defs>
      <marker id={markerId} markerWidth="14" markerHeight="14" viewBox="0 0 12 12" refX="9.5" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 Z" fill={color} />
      </marker>
      {props.selected && <filter id={selectionFilterId} filterUnits="userSpaceOnUse" {...selectionFilterBounds} colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={CONNECTION_COLORS.selectedShadow} floodOpacity=".32" />
      </filter>}
    </defs>
    <BaseEdge
      path={path}
      markerStart={data.direction === 'both' ? `url(#${markerId})` : undefined}
      markerEnd={data.direction === 'forward' || data.direction === 'both' ? `url(#${markerId})` : undefined}
      style={{ stroke: color, strokeWidth: props.selected ? 3 : 2, strokeLinecap: data.direction === 'none' ? 'round' : 'butt', strokeLinejoin: 'round', strokeDasharray: data.stroke === 'dashed' ? '7 5' : undefined, filter: props.selected ? `url(#${selectionFilterId})` : undefined }}
    />
    {props.selected && <EdgeLabelRenderer>
      <CanvasConnectionToolbar style={data} x={labelX} y={labelY} onUpdate={update} onDelete={remove} />
    </EdgeLabelRenderer>}
  </>;
}

/** The shared toolbar for every selected canvas connection, including floating lines. */
export function CanvasConnectionToolbar({ style, x, y, onUpdate, onDelete }: {
  style: CanvasConnectionStyle;
  x: number;
  y: number;
  onUpdate: (patch: Partial<CanvasConnectionStyle>) => void;
  onDelete: () => void;
}): ReactElement {
  const [openMenu, setOpenMenu] = useState<'shape' | 'stroke' | 'direction' | null>(null);
  const choose = (patch: Partial<CanvasConnectionStyle>) => { onUpdate(patch); setOpenMenu(null); };
  return <div
    className="dw-connection-toolbar nodrag nopan"
    role="toolbar"
    aria-label="连接线操作"
    style={{ transform: `translate(-50%, -100%) translate(${x}px, ${y - 14}px)` }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <ToolbarMenu label="线型" icon={<LineIcon shape={style.shape} />} open={openMenu === 'shape'} onToggle={() => setOpenMenu(openMenu === 'shape' ? null : 'shape')}>
      <MenuOption active={style.shape === 'straight'} icon={<LineIcon shape="straight" />} label="直线" onClick={() => choose({ shape: 'straight' })} />
      <MenuOption active={style.shape === 'curve'} icon={<LineIcon shape="curve" />} label="曲线" onClick={() => choose({ shape: 'curve' })} />
      <MenuOption active={style.shape === 'elbow'} icon={<LineIcon shape="elbow" />} label="折线" onClick={() => choose({ shape: 'elbow' })} />
    </ToolbarMenu>
    <ToolbarMenu label="线条样式" icon={<StrokeIcon stroke={style.stroke} />} open={openMenu === 'stroke'} onToggle={() => setOpenMenu(openMenu === 'stroke' ? null : 'stroke')}>
      <MenuOption active={style.stroke === 'solid'} icon={<StrokeIcon stroke="solid" />} label="实线" onClick={() => choose({ stroke: 'solid' })} />
      <MenuOption active={style.stroke === 'dashed'} icon={<StrokeIcon stroke="dashed" />} label="虚线" onClick={() => choose({ stroke: 'dashed' })} />
    </ToolbarMenu>
    <ToolbarMenu label="连接方向" icon={<DirectionIcon direction={style.direction} />} open={openMenu === 'direction'} onToggle={() => setOpenMenu(openMenu === 'direction' ? null : 'direction')}>
      <MenuOption active={style.direction === 'none'} icon={<DirectionIcon direction="none" />} label="无方向" onClick={() => choose({ direction: 'none' })} />
      <MenuOption active={style.direction === 'forward'} icon={<DirectionIcon direction="forward" />} label="有向" onClick={() => choose({ direction: 'forward' })} />
      <MenuOption active={style.direction === 'both'} icon={<DirectionIcon direction="both" />} label="双向" onClick={() => choose({ direction: 'both' })} />
    </ToolbarMenu>
    <button type="button" className="dw-connection-toolbar__delete" aria-label="删除连线" onClick={onDelete}>
      <TrashIcon />
      <span role="tooltip">删除连线</span>
    </button>
  </div>;
}

function ToolbarMenu({ children, icon, label, open, onToggle }: { children: ReactElement[]; icon: ReactElement; label: string; open: boolean; onToggle: () => void }): ReactElement {
  return <div className="dw-connection-toolbar__group">
    <button type="button" className="dw-connection-toolbar__trigger" aria-label={label} aria-expanded={open} onClick={onToggle}>{icon}<ChevronIcon /></button>
    {open && <div className="dw-connection-toolbar__menu" role="menu">{children}</div>}
  </div>;
}

function MenuOption({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return <button type="button" role="menuitemradio" aria-checked={active} onClick={onClick}>{icon}<span>{label}</span>{active && <CheckIcon />}</button>;
}

function LineIcon({ shape }: { shape: CanvasConnectionShape }): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={shape === 'straight' ? 'M4 4 20 20' : shape === 'elbow' ? 'M4 19h7a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3h3' : 'M3 18C8 18 7 6 13 6s3 12 8 12'} /></svg>;
}

function StrokeIcon({ stroke }: { stroke: CanvasConnectionStroke }): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path className={stroke === 'dashed' ? 'is-dashed' : undefined} d="M3 12h18" /></svg>;
}

function DirectionIcon({ direction }: { direction: CanvasConnectionDirection }): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h15" />{direction !== 'none' && <path d="m14 7 5 5-5 5" />}{direction === 'both' && <path d="m8 7-5 5 5 5" />}</svg>;
}

function ChevronIcon(): ReactElement { return <svg className="dw-connection-toolbar__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>; }
function CheckIcon(): ReactElement { return <svg className="dw-connection-toolbar__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>; }
function TrashIcon(): ReactElement { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg>; }
