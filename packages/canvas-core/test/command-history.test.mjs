import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, createId, createEmptyDocument, InMemoryCanvasDocumentRepository, invertCommand, CanvasDocumentService, CanvasHistoryService } from '../dist/index.js';

const time = '2026-07-22T00:00:00.000Z';
const projectId = 'project-1';
function markdownItem(id) { return { id, kind: 'markdown', title: '角色设定', summary: '', markdown: '初稿', createdAt: time, updatedAt: time }; }
function placement(itemId, x = 0) { return { itemId, x, y: 0, width: 320, height: 200, zIndex: 1 }; }
function command(type, payload, actor = 'user') { return { id: createId('cmd'), projectId, createdAt: time, actor, type, ...payload }; }

test('inverting deletion produces ordinary create commands with original content and placement', () => {
  let document = createEmptyDocument(projectId);
  document = applyCommand(document, command('create-item', { item: markdownItem('markdown-1'), placement: placement('markdown-1') }));
  const inverse = invertCommand(document, command('delete-item', { itemId: 'markdown-1' }));
  assert.equal(inverse.length, 1);
  assert.equal(inverse[0].type, 'create-item');
  const restored = inverse.reduce((current, next) => applyCommand(current, next), applyCommand(document, command('delete-item', { itemId: 'markdown-1' })));
  assert.equal(restored.items.get('markdown-1').kind, 'markdown');
});

test('batch history deletes and restores every independent node atomically', async () => {
  const repository = new InMemoryCanvasDocumentRepository();
  const service = new CanvasDocumentService(projectId, repository);
  await service.initialize();
  const history = new CanvasHistoryService(service);
  history.executeBatch([
    command('create-item', { item: markdownItem('markdown-a'), placement: placement('markdown-a') }),
    command('create-item', { item: markdownItem('markdown-b'), placement: placement('markdown-b', 400) }),
  ]);
  history.execute(command('delete-items', { itemIds: ['markdown-a', 'markdown-b'] }));
  assert.equal(service.getDocument().items.size, 0);
  assert.equal(history.undo(), true);
  assert.deepEqual(new Set(service.getDocument().items.keys()), new Set(['markdown-a', 'markdown-b']));
  assert.equal(history.redo(), true);
  assert.equal(service.getDocument().items.size, 0);
});

test('history coalesces a drag group and preserves the first inverse', async () => {
  const repository = new InMemoryCanvasDocumentRepository();
  const service = new CanvasDocumentService(projectId, repository);
  await service.initialize();
  const history = new CanvasHistoryService(service);
  history.execute(command('create-item', { item: markdownItem('markdown-1'), placement: placement('markdown-1') }));
  history.execute(command('set-placements', { placements: [placement('markdown-1', 100)] }), 'drag:markdown-1');
  history.execute(command('set-placements', { placements: [placement('markdown-1', 300)] }), 'drag:markdown-1');
  assert.equal(history.undo(), true);
  assert.equal(service.getDocument().placements.get('markdown-1').x, 0);
  assert.equal(history.redo(), true);
  assert.equal(service.getDocument().placements.get('markdown-1').x, 300);
});

test('revision conflict replaces the document and invalidates rejected command history', async () => {
  const repository = new InMemoryCanvasDocumentRepository();
  const first = new CanvasDocumentService(projectId, repository);
  const second = new CanvasDocumentService(projectId, repository);
  await first.initialize(); await second.initialize();
  const firstHistory = new CanvasHistoryService(first);
  const secondHistory = new CanvasHistoryService(second);
  const historySnapshots = [];
  const documentSnapshots = [];
  secondHistory.onDidChange.subscribe((change) => historySnapshots.push(change));
  second.onDidChange.subscribe(({ document }) => documentSnapshots.push([...document.items.keys()]));

  firstHistory.execute(command('create-item', { item: markdownItem('markdown-a'), placement: placement('markdown-a') }));
  await first.flush();
  secondHistory.execute(command('create-item', { item: markdownItem('markdown-b'), placement: placement('markdown-b', 500) }));
  await second.flush();

  const stored = await repository.load(projectId);
  assert.deepEqual(stored.items.map((item) => item.id), ['markdown-a']);
  assert.deepEqual([...second.getDocument().items.keys()], ['markdown-a']);
  assert.deepEqual(documentSnapshots.at(-1), ['markdown-a']);
  assert.deepEqual(historySnapshots.at(-1), { canUndo: false, canRedo: false });
  assert.equal(secondHistory.canUndo(), false);
  assert.equal(secondHistory.canRedo(), false);
  assert.equal(secondHistory.undo(), false);
  assert.equal(secondHistory.redo(), false);
  assert.equal((await repository.load(projectId)).revision, 1);
});

test('terminal persistence rejection can discard optimistic nodes and reload the server snapshot', async () => {
  const snapshot = { projectId, revision: 0, items: [], placements: [], connections: [] };
  const rejection = Object.assign(new Error('invalid mutation'), { status: 422 });
  const repository = {
    _serviceBrand: undefined,
    async load() { return structuredClone(snapshot); },
    async apply() { throw rejection; },
    dispose() {},
  };
  const service = new CanvasDocumentService(projectId, repository);
  await service.initialize();
  const history = new CanvasHistoryService(service);
  const dropped = [];
  service.onDidConflict.subscribe((event) => dropped.push(...event.droppedCommandIds));

  const rejected = command('create-item', { item: markdownItem('optimistic-node'), placement: placement('optimistic-node') });
  history.execute(rejected);
  await assert.rejects(service.flush(), /invalid mutation/);
  assert.equal(service.getDocument().items.has('optimistic-node'), true);

  await service.discardPendingAndReload();
  assert.equal(service.getDocument().items.size, 0);
  assert.deepEqual(dropped, [rejected.id]);
  assert.equal(history.canUndo(), false);
});

test('connection commands persist, update, delete, and restore with deleted nodes', async () => {
  const repository = new InMemoryCanvasDocumentRepository();
  const service = new CanvasDocumentService(projectId, repository);
  await service.initialize();
  const history = new CanvasHistoryService(service);
  history.executeBatch([
    command('create-item', { item: markdownItem('a'), placement: placement('a') }),
    command('create-item', { item: markdownItem('b'), placement: placement('b', 400) }),
  ]);
  const connection = { id: 'edge-1', sourceItemId: 'a', sourceHandle: 'right', sourceX: 320, sourceY: 100, targetItemId: 'b', targetHandle: 'left', targetX: 400, targetY: 100, shape: 'curve', stroke: 'solid', direction: 'forward' };
  history.execute(command('create-connection', { connection }));
  history.execute(command('update-connection', { connection: { ...connection, stroke: 'dashed', direction: 'both' } }));
  assert.deepEqual(service.getDocument().connections.get('edge-1'), { ...connection, stroke: 'dashed', direction: 'both' });
  await service.flush();
  assert.equal((await repository.load(projectId)).connections.length, 1);
  history.execute(command('delete-item', { itemId: 'a' }));
  assert.deepEqual(service.getDocument().connections.get('edge-1'), { ...connection, sourceItemId: undefined, sourceHandle: undefined, stroke: 'dashed', direction: 'both' });
  assert.equal(history.undo(), true);
  assert.deepEqual(service.getDocument().connections.get('edge-1'), { ...connection, stroke: 'dashed', direction: 'both' });
});

test('deleting a connection emits its command, preserves nodes, and supports undo and redo', async () => {
  const backingRepository = new InMemoryCanvasDocumentRepository();
  const appliedBatches = [];
  const repository = {
    _serviceBrand: undefined,
    load: (id) => backingRepository.load(id),
    async apply(id, revision, commands) {
      appliedBatches.push(structuredClone(commands));
      return backingRepository.apply(id, revision, commands);
    },
    dispose: () => backingRepository.dispose(),
  };
  const service = new CanvasDocumentService(projectId, repository);
  await service.initialize();
  const history = new CanvasHistoryService(service);
  const connection = { id: 'edge-delete', sourceItemId: 'a', sourceHandle: 'right', sourceX: 320, sourceY: 100, targetItemId: 'b', targetHandle: 'left', targetX: 400, targetY: 100, shape: 'curve', stroke: 'solid', direction: 'forward' };

  history.executeBatch([
    command('create-item', { item: markdownItem('a'), placement: placement('a') }),
    command('create-item', { item: markdownItem('b'), placement: placement('b', 400) }),
    command('create-connection', { connection }),
  ]);
  await service.flush();
  appliedBatches.length = 0;

  history.execute(command('delete-connection', { connectionId: connection.id }));
  expectConnectionDeletion(appliedBatches, connection.id);
  assert.equal(service.getDocument().connections.has(connection.id), false);
  assert.deepEqual(new Set(service.getDocument().items.keys()), new Set(['a', 'b']));
  await service.flush();
  expectConnectionDeletion(appliedBatches, connection.id);

  assert.equal(history.undo(), true);
  assert.deepEqual(service.getDocument().connections.get(connection.id), connection);
  assert.deepEqual(new Set(service.getDocument().items.keys()), new Set(['a', 'b']));

  assert.equal(history.redo(), true);
  assert.equal(service.getDocument().connections.has(connection.id), false);
  assert.deepEqual(new Set(service.getDocument().items.keys()), new Set(['a', 'b']));
});

function expectConnectionDeletion(batches, connectionId) {
  assert.ok(batches.flat().some((entry) => entry.type === 'delete-connection' && entry.connectionId === connectionId));
}
