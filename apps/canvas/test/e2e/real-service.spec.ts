import { expect, test } from '@playwright/test';

const email = process.env.DW_E2E_ADMIN_EMAIL ?? 'ci-admin@example.test';
const password = process.env.DW_E2E_ADMIN_PASSWORD;

test('same account in two browser contexts receives one 409 and keeps only the accepted mutation', async ({ browser }) => {
  if (!password) throw new Error('DW_E2E_ADMIN_PASSWORD is required for the no-mock real-service suite.');
  const first = await browser.newContext({ ignoreHTTPSErrors: true });
  const firstPage = await first.newPage();
  const origin = e2eOrigin();
  const login = await firstPage.request.post('/api/dreamweave/v1/auth/sessions', { data: { email, password }, headers: { Origin: origin } });
  expect(login.ok()).toBeTruthy();
  const project = await firstPage.request.post('/api/dreamweave/v1/projects', { data: { title: 'two-writer', summary: 'real integration' }, headers: { Origin: origin } });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json()).id as string;
  const initial = await firstPage.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`);
  expect(initial.ok()).toBeTruthy();
  const revision = String((await initial.json()).revision);
  const state = await first.storageState();
  const second = await browser.newContext({ storageState: state, ignoreHTTPSErrors: true });
  const secondPage = await second.newPage();
  const accepted = await firstPage.request.post(`/api/dreamweave/v1/projects/${projectId}/canvas/commands`, { data: command(revision, crypto.randomUUID(), 'first request'), headers: { Origin: origin } });
  expect(accepted.status()).toBe(200);
  const rejected = await secondPage.request.post(`/api/dreamweave/v1/projects/${projectId}/canvas/commands`, { data: command(revision, crypto.randomUUID(), 'second request'), headers: { Origin: origin } });
  expect(rejected.status()).toBe(409);
  await expect(rejected.json()).resolves.toMatchObject({
    code: 'CANVAS_REVISION_CONFLICT',
    canvasRevisionConflict: { currentRevision: String(Number(revision) + 1) },
  });
  const current = await firstPage.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`);
  const snapshot = await current.json() as { nodes: Array<{ id: string }> };
  expect(snapshot.nodes.map((node) => node.id)).toHaveLength(1);
  expect(snapshot.nodes.map((node) => node.id)).toHaveLength(1);
  await second.close(); await first.close();
});

test('a UI-created connection can be deleted and remains absent after reload through the real backend', async ({ browser }) => {
  if (!password) throw new Error('DW_E2E_ADMIN_PASSWORD is required for the no-mock real-service suite.');
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const origin = e2eOrigin();
  const headers = { Origin: origin };
  const login = await page.request.post('/api/dreamweave/v1/auth/sessions', { data: { email, password }, headers });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post('/api/dreamweave/v1/projects', { data: { title: 'connection persistence', summary: 'real connection integration' }, headers });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json() as { id: string }).id;
  const sourceId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const seeded = await page.request.post(`/api/dreamweave/v1/projects/${projectId}/canvas/commands`, {
    headers,
    data: {
      expectedRevision: '0',
      requestId: crypto.randomUUID(),
      mutations: [
        { createMarkdownNode: { nodeId: sourceId, markdown: 'source', placement: { nodeId: sourceId, x: 100, y: 160, width: 420, height: 220, zIndex: 1 } } },
        { createMarkdownNode: { nodeId: targetId, markdown: 'target', placement: { nodeId: targetId, x: 900, y: 420, width: 420, height: 220, zIndex: 2 } } },
      ],
    },
  });
  expect(seeded.ok()).toBeTruthy();

  const requestBase = new URL(process.env.DW_E2E_BASE_URL ?? origin);
  if (requestBase.hostname !== new URL(origin).hostname) {
    const cookies = await context.cookies();
    await context.addCookies(cookies.map(({ domain: _domain, ...cookie }) => ({ ...cookie, domain: new URL(origin).hostname })));
  }
  await page.goto(`${origin}/?projectId=${projectId}`);
  const source = page.locator(`.react-flow__node[data-id="${sourceId}"] .dw-connection-handle--right`);
  const target = page.locator(`.react-flow__node[data-id="${targetId}"] .dw-connection-handle--left`);
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Persisted connection fixture handles are not visible');
  const createResponse = page.waitForResponse(canvasCommandResponse);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  const createdConnection = await createResponse;
  expect(createdConnection.ok(), await createdConnection.text()).toBeTruthy();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  const toolbar = page.getByRole('toolbar', { name: '连接线操作' });
  const strokeResponse = page.waitForResponse(canvasCommandResponse);
  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '虚线' }).click();
  const updatedStroke = await strokeResponse;
  expect(updatedStroke.ok(), await updatedStroke.text()).toBeTruthy();
  const directionResponse = page.waitForResponse(canvasCommandResponse);
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '双向' }).click();
  const updatedDirection = await directionResponse;
  expect(updatedDirection.ok(), await updatedDirection.text()).toBeTruthy();

  await page.reload();
  const persistedEdge = page.locator('.react-flow__edge');
  await expect(persistedEdge).toHaveCount(1);
  await expect(persistedEdge.locator('.react-flow__edge-path')).toHaveCSS('stroke-dasharray', '7px, 5px');
  await expect(persistedEdge.locator('path[marker-start]')).toHaveCount(1);
  await expect(persistedEdge.locator('path[marker-end]')).toHaveCount(1);
  const snapshot = await (await page.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`)).json() as { connections: Array<{ sourceNodeId: string; targetNodeId: string; stroke: string; direction: string }> };
  expect(snapshot.connections).toEqual([{ sourceNodeId: sourceId, targetNodeId: targetId, sourceHandle: 'right', targetHandle: 'left', id: expect.any(String), shape: 'curve', stroke: 'dashed', direction: 'both' }]);

  await persistedEdge.locator('.react-flow__edge-interaction').click();
  const deleteButton = page.getByRole('toolbar', { name: '连接线操作' }).getByRole('button', { name: '删除连线' });
  await expect(deleteButton).toBeVisible();
  await expect(deleteButton).toBeEnabled();
  const deleteResponse = page.waitForResponse(canvasCommandResponse);
  await deleteButton.click();
  const deletedConnection = await deleteResponse;
  expect(deletedConnection.ok(), await deletedConnection.text()).toBeTruthy();
  await expect(persistedEdge).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  const deletedSnapshot = await (await page.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`)).json() as { connections: unknown[] };
  expect(deletedSnapshot.connections).toEqual([]);
  await context.close();
});

function canvasCommandResponse(response: import('@playwright/test').Response): boolean {
  return response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/canvas/commands');
}

function e2eOrigin(): string {
  return process.env.DW_E2E_ORIGIN ?? new URL(process.env.DW_E2E_BASE_URL ?? 'http://127.0.0.1:4179').origin;
}

function command(expectedRevision: string, nodeId: string, markdown: string) {
  return { expectedRevision, requestId: crypto.randomUUID(), mutations: [{ createMarkdownNode: { nodeId, markdown, placement: { nodeId, x: 100, y: 100, width: 420, height: 320, zIndex: 1 } } }] };
}
