import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadPlacements, estimateMarkdownPlacementHeight } from '../dist/index.js';

test('upload placements preserve input order and cascade diagonally from the viewport center', () => {
  const placements = createUploadPlacements([
    { itemId: 'image-first', kind: 'image' },
    { itemId: 'markdown-second', kind: 'markdown' },
    { itemId: 'pdf-third', kind: 'pdf' },
  ], { x: 100, y: 200 }, 7);

  assert.deepEqual(placements, [
    { itemId: 'image-first', x: 100, y: 200, width: 360, height: 360, zIndex: 8 },
    { itemId: 'markdown-second', x: 132, y: 232, width: 550, height: 100, zIndex: 9 },
    { itemId: 'pdf-third', x: 164, y: 264, width: 420, height: 560, zIndex: 10 },
  ]);
});

test('audio uploads use the compact playback-node height', () => {
  const [placement] = createUploadPlacements([{ itemId: 'audio', kind: 'audio' }], { x: 0, y: 0 }, 0);
  assert.deepEqual(placement, { itemId: 'audio', x: 0, y: 0, width: 640, height: 280, zIndex: 1 });
});

test('Markdown and text imports open at their estimated content height and cap at the node maximum', () => {
  const [paragraphs] = createUploadPlacements([{ itemId: 'markdown', kind: 'markdown', markdown: '第一段\n\n第二段\n\n第三段\n\n第四段' }], { x: 0, y: 0 }, 0);
  assert.equal(paragraphs.height, 160);

  const longText = '劳动合同条款'.repeat(2_000);
  const [longImport] = createUploadPlacements([{ itemId: 'text', kind: 'markdown', markdown: longText }], { x: 0, y: 0 }, 0);
  assert.equal(longImport.height, 924.333);
  assert.equal(estimateMarkdownPlacementHeight(''), 100);
});
