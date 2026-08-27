import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyDocument, documentFromSnapshot, documentToSnapshot, fromDto } from '../dist/index.js';

const time = '2026-07-22T00:00:00.000Z';
function markdownItem(id = 'markdown-1') { return { id, kind: 'markdown', title: '世界观', summary: '', markdown: '# 世界观', createdAt: time, updatedAt: time }; }
function placement(itemId) { return { itemId, x: 0, y: 0, width: 320, height: 200, zIndex: 1 }; }

test('round-trips a serializable independent project canvas snapshot', () => {
  const document = createEmptyDocument('project-1');
  document.items.set('markdown-1', markdownItem());
  document.placements.set('markdown-1', placement('markdown-1'));
  const snapshot = documentToSnapshot(document);
  assert.deepEqual(documentToSnapshot(documentFromSnapshot(snapshot)), snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), ['connections', 'items', 'placements', 'projectId', 'revision']);
});

test('accepts an empty Markdown node returned immediately after creation', () => {
  const document = fromDto({
    projectId: 'project-1', revision: '1',
    nodes: [{ id: 'markdown-1', kind: 'markdown', title: 'Untitled text', summary: '', renderData: { markdown: { markdown: '' } }, createdAt: time, updatedAt: time }],
    placements: [{ nodeId: 'markdown-1', x: 0, y: 0, width: 320, height: 200, zIndex: 1 }],
    connections: [],
  });
  assert.equal(document.items.find((item) => item.id === 'markdown-1').markdown, '');
});

test('accepts the FFmpeg container description returned for an audio asset', () => {
  const document = fromDto({
    projectId: 'project-1', revision: '1',
    nodes: [{ id: 'audio-1', kind: 'audio', title: 'Recording', summary: '', assetId: 'asset-1', renderData: { audio: { format: 'mov,mp4,m4a,3gp,3g2,mj2', durationMs: '1068', waveform: Array(64).fill(0), sceneLabel: '' } }, createdAt: time, updatedAt: time }],
    placements: [{ nodeId: 'audio-1', x: 0, y: 0, width: 320, height: 200, zIndex: 1 }],
    connections: [],
  });
  assert.equal(document.items.find((item) => item.id === 'audio-1').format, 'mov,mp4,m4a,3gp,3g2,mj2');
});

test('rejects non-integer z-index geometry', () => {
  assert.throws(() => documentFromSnapshot({ projectId: 'project-1', revision: 0, items: [markdownItem()], placements: [{ ...placement('markdown-1'), zIndex: 1.5 }], connections: [] }));
});

test('enforces audio waveform, HTTPS web preview, and office mapping render contracts', () => {
  const base = { id: 'node', title: 'node', summary: '', createdAt: time, updatedAt: time };
  assert.throws(() => documentFromSnapshot({ projectId: 'p', revision: 0, items: [{ ...base, kind: 'audio', assetId: 'asset', format: 'mp3', durationMs: 0, waveform: [0], sceneLabel: '' }], placements: [placement('node')], connections: [] }), /Audio item/);
  assert.throws(() => documentFromSnapshot({ projectId: 'p', revision: 0, items: [{ ...base, kind: 'web-preview', assetId: 'asset', url: 'http://example.test', embeddable: true }], placements: [placement('node')], connections: [] }), /HTTPS/);
  assert.throws(() => documentFromSnapshot({ projectId: 'p', revision: 0, items: [{ ...base, kind: 'office', assetId: 'asset', officeKind: 'word', fileType: 'xlsx', previewAvailable: true }], placements: [placement('node')], connections: [] }), /Office item/);
});

test('round-trips connections and rejects references to unknown nodes', () => {
  const document = createEmptyDocument('project-1');
  for (const id of ['a', 'b']) {
    document.items.set(id, markdownItem(id));
    document.placements.set(id, placement(id));
  }
  const connection = { id: 'edge-1', sourceItemId: 'a', sourceHandle: 'right', sourceX: 320, sourceY: 100, targetItemId: 'b', targetHandle: 'left', targetX: 0, targetY: 100, shape: 'curve', stroke: 'solid', direction: 'forward' };
  document.connections.set(connection.id, connection);
  assert.deepEqual(documentFromSnapshot(documentToSnapshot(document)).connections.get('edge-1'), connection);
  assert.throws(() => documentFromSnapshot({ ...documentToSnapshot(document), items: [markdownItem('a')], placements: [placement('a')] }), /unknown item/);
  assert.doesNotThrow(() => documentFromSnapshot({ ...documentToSnapshot(document), connections: [{ ...connection, targetItemId: undefined, targetHandle: undefined }] }));
  assert.throws(() => documentFromSnapshot({ ...documentToSnapshot(document), connections: [{ ...connection, targetItemId: undefined }] }), /invalid target attachment/);
});
