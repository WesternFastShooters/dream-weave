import { memo, type PointerEvent } from 'react';
import type { NodeToolbarAction } from './types.js';

export function DuplicateLinedIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="4" width="11" height="11" rx="2" fill="none"/><rect x="4" y="8" width="11" height="11" rx="2" fill="none"/></svg>; }
export function DownloadLinedIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3" fill="none"/></svg>; }
export function TrashLinedIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" fill="none"/></svg>; }

export interface CanvasNodeHoverToolbarViewProps {
  actions: readonly NodeToolbarAction[];
  busyActionId?: NodeToolbarAction['id'] | null;
  tooltipPosition?: 'top' | 'bottom';
  onAction(action: NodeToolbarAction): void;
}
/** Stateless action chrome. Business capability and mutation policy stay in the adapter. */
export const CanvasNodeHoverToolbarView = memo(function CanvasNodeHoverToolbarView({ actions, busyActionId = null, tooltipPosition = 'top', onAction }: CanvasNodeHoverToolbarViewProps) {
  return <div className={`dw-node-toolbar dw-node-toolbar--tooltip-${tooltipPosition} nodrag nopan nowheel`} role="toolbar" aria-label="节点操作" aria-busy={busyActionId !== null} onPointerDown={stopPointer}>
    {actions.map((action, index) => <span key={action.id} className="dw-node-toolbar__entry">
      {index === actions.length - 1 && <span className="dw-node-toolbar__separator" aria-hidden="true" />}
      <button type="button" className="dw-node-toolbar__button nodrag nopan nowheel" aria-label={action.label} data-tooltip={action.label} disabled={busyActionId !== null} onPointerDown={stopPointer} onClick={() => onAction(action)}>{busyActionId === action.id ? '…' : icon(action.icon)}</button>
    </span>)}
  </div>;
});
function stopPointer(event: PointerEvent<HTMLElement>): void { event.stopPropagation(); }
function icon(name: NodeToolbarAction['icon']) { if (name === 'duplicate') return <DuplicateLinedIcon />; if (name === 'download') return <DownloadLinedIcon />; return <TrashLinedIcon />; }
