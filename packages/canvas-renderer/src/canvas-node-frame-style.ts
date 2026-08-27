import type { CSSProperties } from 'react';

/** Shared generic canvas-node chrome. */
export const CANVAS_NODE_SELECTED_OUTLINE_STYLE: CSSProperties = {
  outline: '2px solid var(--dream-weave-canvas-selection-color, #88B5FF)',
  outlineOffset: '0px',
};

export const CANVAS_NODE_DRAGGING_OUTLINE_BOX_SHADOW = '0 0 0 1px rgba(43, 91, 138, 0.9)';
export const CANVAS_NODE_STROKE_BOX_SHADOW = 'inset 0 0 0 1px #E9E9E9';
export const CANVAS_NODE_DROP_SHADOW = '0px 1.5px 3px 0px rgba(0, 0, 0, 0.05)';

export function getCanvasNodeFrameStyle({ dragging, selected }: { dragging?: boolean; selected?: boolean }): CSSProperties {
  const boxShadow =
    dragging && !selected
      ? `${CANVAS_NODE_DRAGGING_OUTLINE_BOX_SHADOW}, ${CANVAS_NODE_STROKE_BOX_SHADOW}, ${CANVAS_NODE_DROP_SHADOW}`
      : `${CANVAS_NODE_STROKE_BOX_SHADOW}, ${CANVAS_NODE_DROP_SHADOW}`;
  return {
    boxShadow,
    ...(selected ? CANVAS_NODE_SELECTED_OUTLINE_STYLE : {}),
  };
}
