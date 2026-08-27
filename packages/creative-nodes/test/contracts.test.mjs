import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_NODE_SIZES, defaultPlacement } from '../dist/types.js';
import { markdownSummary } from '../dist/creative-node-service.js';

test('renderer defaults cover precisely the nine persisted node kinds', () => {
  assert.deepEqual(Object.keys(DEFAULT_NODE_SIZES), ['markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame']);
  assert.deepEqual(defaultPlacement('node', 'markdown', 10, 20, 3), { itemId: 'node', x: 10, y: 20, width: 550, height: 100, zIndex: 3 });
});
test('markdown summary is an ephemeral, bounded renderer projection', () => {
  assert.equal(markdownSummary('# Hello **world**'), 'Hello world');
  assert.equal(markdownSummary('a'.repeat(200)).length, 160);
});
