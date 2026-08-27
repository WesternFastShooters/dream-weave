import { DEFAULT_NODE_DIMENSIONS } from '@dream-weave/canvas-core';
import { describe, expect, it } from 'vitest';
import { DIRECTIONAL_MARKDOWN_GAP, DIRECTIONAL_TREE_SIBLING_GAP, getDirectionalConnectionHandles, getDirectionalMarkdownPlacement, getDirectionalTreePlacements, isDirectionalMarkdownKey } from '../src/directional-markdown-placement.js';

const source = { itemId: 'source', x: 200, y: 300, width: 640, height: 280, zIndex: 1 };
const [markdownWidth, markdownHeight] = DEFAULT_NODE_DIMENSIONS.markdown;

describe('directional text-node placement', () => {
  it.each([
    ['ArrowUp', { x: 245, y: 168 }],
    ['ArrowRight', { x: 872, y: 390 }],
    ['ArrowDown', { x: 245, y: 612 }],
    ['ArrowLeft', { x: -382, y: 390 }],
  ] as const)('places a new text node %s of the selected node', (direction, expected) => {
    expect(getDirectionalMarkdownPlacement(source, direction)).toEqual(expected);
  });

  it('uses the default text-node dimensions and a stable gap', () => {
    expect(DIRECTIONAL_MARKDOWN_GAP).toBe(32);
    expect(getDirectionalMarkdownPlacement(source, 'ArrowDown').y).toBe(source.y + source.height + DIRECTIONAL_MARKDOWN_GAP);
    expect(getDirectionalMarkdownPlacement(source, 'ArrowLeft').x).toBe(source.x - markdownWidth - DIRECTIONAL_MARKDOWN_GAP);
    expect(getDirectionalMarkdownPlacement(source, 'ArrowUp').y).toBe(source.y - markdownHeight - DIRECTIONAL_MARKDOWN_GAP);
  });

  it.each(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'])('recognizes %s as a directional shortcut key', (key) => {
    expect(isDirectionalMarkdownKey(key)).toBe(true);
  });

  it('does not recognize unrelated keys', () => {
    expect(isDirectionalMarkdownKey('a')).toBe(false);
  });

  it.each([
    ['ArrowUp', { sourceHandle: 'top', targetHandle: 'bottom' }],
    ['ArrowRight', { sourceHandle: 'right', targetHandle: 'left' }],
    ['ArrowDown', { sourceHandle: 'bottom', targetHandle: 'top' }],
    ['ArrowLeft', { sourceHandle: 'left', targetHandle: 'right' }],
  ] as const)('connects %s from the old node toward the new node', (direction, expected) => {
    expect(getDirectionalConnectionHandles(direction)).toEqual(expected);
  });

  it('fans right-side sibling nodes out vertically around the source, as Excalidraw flowcharts do', () => {
    expect(DIRECTIONAL_TREE_SIBLING_GAP).toBe(100);
    expect(getDirectionalTreePlacements(source, [
      { itemId: 'first', width: markdownWidth, height: markdownHeight },
      { itemId: 'second', width: markdownWidth, height: markdownHeight },
    ], 'ArrowRight')).toEqual([
      { itemId: 'first', x: 872, y: 290 },
      { itemId: 'second', x: 872, y: 490 },
    ]);
  });

  it('fans bottom-side sibling nodes out horizontally around the source', () => {
    expect(getDirectionalTreePlacements(source, [
      { itemId: 'first', width: markdownWidth, height: markdownHeight },
      { itemId: 'second', width: markdownWidth, height: markdownHeight },
    ], 'ArrowDown')).toEqual([
      { itemId: 'first', x: -80, y: 612 },
      { itemId: 'second', x: 570, y: 612 },
    ]);
  });
});
