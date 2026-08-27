import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import { useLayoutEffect, useState, type CSSProperties, type ReactElement } from 'react';

type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';

const CONNECTION_SIDES: readonly { readonly id: ConnectionSide; readonly label: string; readonly position: Position }[] = [
  { id: 'top', label: '从上侧连接', position: Position.Top },
  { id: 'right', label: '从右侧连接', position: Position.Right },
  { id: 'bottom', label: '从下侧连接', position: Position.Bottom },
  { id: 'left', label: '从左侧连接', position: Position.Left },
];

const BORDER_SELECTOR_BY_NODE_KIND: Readonly<Record<string, string>> = {
  markdown: '.dw-product-brief__surface',
  image: '.dw-resource-node__surface',
  audio: '.dw-audio-node__surface',
  video: '.dw-video-node__surface',
  'web-preview': '.dw-resource-node__surface',
  html: '.dw-resource-node__surface',
  pdf: '.dw-resource-node__surface',
  office: '.dw-resource-node__surface',
  frame: '.dw-frame-node',
};

type BorderInsets = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
const NO_INSETS: BorderInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Wraps each product node with the four shared connection handles. Keeping the
 * handles at the renderer boundary means every current and future node kind
 * gets the same connection affordance without modifying product renderers.
 */
export function withConnectionHandles(component: NodeTypes[string]): NodeTypes[string] {
  return function CanvasConnectableNode(props: NodeProps): ReactElement {
    const NodeComponent = component;
    const nodeKind = typeof (props.data as { item?: { kind?: unknown } }).item?.kind === 'string'
      ? (props.data as { item: { kind: string } }).item.kind
      : 'unknown';
    const borderInsets = useBorderInsets(props.id, nodeKind);
    const anchorStyle = {
      '--dw-connection-border-top': `${borderInsets.top}px`,
      '--dw-connection-border-right': `${borderInsets.right}px`,
      '--dw-connection-border-bottom': `${borderInsets.bottom}px`,
      '--dw-connection-border-left': `${borderInsets.left}px`,
    } as CSSProperties;
    return <>
      <NodeComponent {...props} />
      {CONNECTION_SIDES.map(({ id, label, position }) => <span key={id} className={`dw-connection-anchor dw-connection-anchor--${id}`} data-node-kind={nodeKind} style={anchorStyle}>
        <Handle id={id} type="source" position={position} className={`dw-connection-handle dw-connection-handle--${id}`} aria-label={label} />
      </span>)}
    </>;
  };
}

/** Align anchors with the rendered border instead of assuming the React Flow
 * wrapper is visible. Titles, padding and responsive media differ per node. */
function useBorderInsets(nodeId: string, nodeKind: string): BorderInsets {
  const [insets, setInsets] = useState<BorderInsets>(NO_INSETS);

  useLayoutEffect(() => {
    const outer = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    const border = outer?.querySelector<HTMLElement>(BORDER_SELECTOR_BY_NODE_KIND[nodeKind] ?? '.dw-node');
    if (!outer || !border) return;
    const update = () => {
      const outerRect = outer.getBoundingClientRect();
      const borderRect = border.getBoundingClientRect();
      const scaleX = outer.offsetWidth === 0 ? 1 : outerRect.width / outer.offsetWidth;
      const scaleY = outer.offsetHeight === 0 ? 1 : outerRect.height / outer.offsetHeight;
      const next = {
        top: Math.max(0, (borderRect.top - outerRect.top) / scaleY),
        right: Math.max(0, (outerRect.right - borderRect.right) / scaleX),
        bottom: Math.max(0, (outerRect.bottom - borderRect.bottom) / scaleY),
        left: Math.max(0, (borderRect.left - outerRect.left) / scaleX),
      };
      setInsets((current) => almostEqualInsets(current, next) ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(border);
    return () => observer.disconnect();
  }, [nodeId, nodeKind]);

  return insets;
}

function almostEqualInsets(left: BorderInsets, right: BorderInsets): boolean {
  return Math.abs(left.top - right.top) < 0.1 && Math.abs(left.right - right.right) < 0.1
    && Math.abs(left.bottom - right.bottom) < 0.1 && Math.abs(left.left - right.left) < 0.1;
}
