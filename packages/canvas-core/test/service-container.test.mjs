import assert from 'node:assert/strict';
import test from 'node:test';
import { getService, InstantiationService } from '@dream-weave/di';
import { CanvasDocumentService, ICanvasDocumentService, ICanvasHistoryService, InMemoryCanvasDocumentRepository, createProjectCanvasContainer } from '../dist/index.js';

test('project containers isolate state and dispose their own services', async () => {
  const root = new InstantiationService();
  const first = createProjectCanvasContainer(root, { projectId: 'project-a', repository: new InMemoryCanvasDocumentRepository() });
  const second = createProjectCanvasContainer(root, { projectId: 'project-b', repository: new InMemoryCanvasDocumentRepository() });
  const firstService = getService(first, ICanvasDocumentService);
  const secondService = getService(second, ICanvasDocumentService);
  await firstService.initialize(); await secondService.initialize();
  assert.equal(firstService.getDocument().projectId, 'project-a');
  assert.ok(getService(first, ICanvasHistoryService));
  first.dispose();
  assert.throws(() => firstService.getDocument());
  assert.equal(secondService.getDocument().projectId, 'project-b');
  root.dispose();
});

test('a document service cannot read before initialization', () => {
  const service = new CanvasDocumentService('project-a', new InMemoryCanvasDocumentRepository());
  assert.throws(() => service.getDocument(), /not initialized/);
});
