import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAssetServiceClient,
  createCanvasServiceClient,
} from '../dist/api/generated/dreamweave/v1/index.js';
import { adaptCanvasCommand } from '../dist/index.js';

function recordingTransport(reply = {}) {
  const calls = [];
  return {
    calls,
    unary: async (path, method, body, meta) => {
      calls.push({ path, method, body, meta });
      return reply;
    },
    serverStream: () => { throw new Error('not used'); },
    duplexStream: () => { throw new Error('not used'); },
  };
}

test('generated Canvas client owns route and canonical int64 request JSON', async () => {
  const transport = recordingTransport({ projectId: 'project-1', revision: '8', nodes: [], placements: [], connections: [] });
  const client = createCanvasServiceClient(transport);
  await client.ApplyCanvasMutations({
    projectId: 'project-1', expectedRevision: '7', requestId: 'request-1', mutations: [{ deleteNodes: { nodeIds: ['node-1'] } }],
  });
  assert.equal(transport.calls[0].path, 'api/dreamweave/v1/projects/project-1/canvas/commands');
  assert.equal(transport.calls[0].method, 'POST');
  assert.equal(JSON.parse(transport.calls[0].body).expectedRevision, '7');
});

test('connection commands map every persisted endpoint and style field', () => {
  const connection = { id: 'edge-1', sourceItemId: 'node-a', sourceHandle: 'right', sourceX: 120, sourceY: 80, targetItemId: 'node-b', targetHandle: 'left', targetX: 360, targetY: 80, shape: 'elbow', stroke: 'dashed', direction: 'both' };
  assert.deepEqual(adaptCanvasCommand({
    id: 'command-1', projectId: 'project-1', createdAt: '2026-07-24T00:00:00.000Z', actor: 'user', type: 'create-connection', connection,
  }), {
    createConnection: { connection: { id: 'edge-1', sourceNodeId: 'node-a', sourceHandle: 'right', sourceX: 120, sourceY: 80, targetNodeId: 'node-b', targetHandle: 'left', targetX: 360, targetY: 80, shape: 'elbow', stroke: 'dashed', direction: 'both' } },
  });
});

test('generated Asset client owns upload route and string byte size', async () => {
  const transport = recordingTransport({ uploadId: 'upload-1', uploadUrl: 'https://upload.test', method: 'PUT', requiredHeaders: {}, expiresAt: '2026-07-23T00:00:00Z' });
  const client = createAssetServiceClient(transport);
  await client.CreateAssetUpload({ projectId: 'project-1', fileName: 'image.png', declaredMimeType: 'image/png', byteSize: '42' });
  assert.equal(transport.calls[0].path, 'api/dreamweave/v1/projects/project-1/asset-uploads');
  assert.equal(JSON.parse(transport.calls[0].body).byteSize, '42');
});

test('Frame title updates use the dedicated persisted mutation', () => {
  const mutation = adaptCanvasCommand({
    id: 'command-1', projectId: 'project-1', createdAt: '2026-07-23T00:00:00.000Z', actor: 'user', type: 'update-item',
    item: { id: 'frame-1', kind: 'frame', title: 'UI-home', summary: '', description: '', color: '#eef0ff', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z' },
  });
  assert.deepEqual(mutation, { updateFrameNode: { nodeId: 'frame-1', title: 'UI-home' } });
});

test('text resize maps complete placement geometry to the persisted API mutation', () => {
  const mutation = adaptCanvasCommand({
    id: 'resize-text-1', projectId: 'project-1', createdAt: '2026-07-24T00:00:00.000Z', actor: 'user', type: 'set-placements',
    placements: [{ itemId: 'text-1', x: 64, y: 96, width: 880, height: 180, zIndex: 3 }],
  });
  assert.deepEqual(mutation, {
    setPlacements: { placements: [{ nodeId: 'text-1', x: 64, y: 96, width: 880, height: 180, zIndex: 3 }] },
  });
});
