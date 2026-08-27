// @vitest-environment jsdom
import { Position } from '@xyflow/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasConnectionEdge, CONNECTION_COLORS, DEFAULT_CONNECTION_STYLE, getCanvasConnectionPath, getConnectionAttachmentArrowOrientation, type CanvasConnectionShape, type CanvasConnectionStroke, type CanvasConnectionDirection } from '../src/canvas-connection-edge.js';
import { anchorConnectionToPlacements, getNearestConnectionHandle } from '../src/canvas-renderer.js';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => children,
  };
});

const pathInput = {
  sourceX: 40,
  sourceY: 60,
  sourcePosition: Position.Right,
  targetX: 360,
  targetY: 240,
  targetPosition: Position.Left,
} as const;

const shapes: CanvasConnectionShape[] = ['straight', 'curve', 'elbow'];
const strokes: CanvasConnectionStroke[] = ['solid', 'dashed'];
const directions: CanvasConnectionDirection[] = ['none', 'forward', 'both'];

describe('Canvas connections', () => {
  it.each(shapes)('creates a valid %s path between two node handles', (shape) => {
    const [path, labelX, labelY] = getCanvasConnectionPath(pathInput, shape);
    expect(path).toMatch(/^M/);
    expect(Number.isFinite(labelX)).toBe(true);
    expect(Number.isFinite(labelY)).toBe(true);
  });

  it.each(strokes.flatMap((stroke) => directions.map((direction) => [stroke, direction] as const)))('supports the %s / %s style combination', (stroke, direction) => {
    expect({ ...DEFAULT_CONNECTION_STYLE, stroke, direction }).toEqual({ shape: 'curve', stroke, direction });
  });

  it('uses neutral connection colors; blue remains reserved for anchors', () => {
    expect(CONNECTION_COLORS).toEqual({ default: '#526074', selected: '#526074', selectedShadow: '#344258' });
    expect(Object.values(CONNECTION_COLORS)).not.toContain('#1686ff');
  });

  it.each([
    ['top', 90],
    ['right', 180],
    ['bottom', 270],
    ['left', 0],
  ] as const)('points an arrow attached to the %s edge into the node', (handle, orientation) => {
    expect(getConnectionAttachmentArrowOrientation(handle)).toBe(orientation);
  });

  it.each([
    [{ x: 300, y: 150 }, 'right'],
    [{ x: -100, y: 150 }, 'left'],
    [{ x: 150, y: -100 }, 'top'],
    [{ x: 150, y: 400 }, 'bottom'],
  ] as const)('reselects the nearest node side when the other endpoint moves', (point, handle) => {
    expect(getNearestConnectionHandle({ itemId: 'node', x: 0, y: 0, width: 300, height: 300, zIndex: 0 }, point)).toBe(handle);
  });

  it('changes both attached arrow sides when a connected node crosses the other node', () => {
    const connection = {
      id: 'connection', sourceItemId: 'source', sourceHandle: 'right' as const, sourceX: 300, sourceY: 150,
      targetItemId: 'target', targetHandle: 'left' as const, targetX: 500, targetY: 150,
      ...DEFAULT_CONNECTION_STYLE,
    };
    const initial = anchorConnectionToPlacements(connection, new Map([
      ['source', { itemId: 'source', x: 0, y: 0, width: 300, height: 300, zIndex: 0 }],
      ['target', { itemId: 'target', x: 500, y: 0, width: 300, height: 300, zIndex: 0 }],
    ]));
    const moved = anchorConnectionToPlacements(connection, new Map([
      ['source', { itemId: 'source', x: 900, y: 0, width: 300, height: 300, zIndex: 0 }],
      ['target', { itemId: 'target', x: 500, y: 0, width: 300, height: 300, zIndex: 0 }],
    ]));

    expect(initial).toMatchObject({ sourceHandle: 'right', targetHandle: 'left', sourceX: 300, targetX: 500 });
    expect(moved).toMatchObject({ sourceHandle: 'left', targetHandle: 'right', sourceX: 900, targetX: 800 });
  });

  it('exposes a selected connection deletion control that delegates its edge id', () => {
    const onDelete = vi.fn();
    render(createElement(CanvasConnectionEdge, {
      id: 'edge-delete',
      selected: true,
      sourceX: 40,
      sourceY: 60,
      sourcePosition: Position.Right,
      targetX: 360,
      targetY: 240,
      targetPosition: Position.Left,
      data: { ...DEFAULT_CONNECTION_STYLE, onDelete },
    }));

    const deleteButton = screen.getByRole<HTMLButtonElement>('button', { name: '删除连线' });
    expect(deleteButton.disabled).toBe(false);
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('edge-delete');
  });
});
