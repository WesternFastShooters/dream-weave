import { expect, test } from '@playwright/test';
import path from 'node:path';

const email = process.env.DW_E2E_ADMIN_EMAIL ?? 'admin@example.test';
const password = process.env.DW_E2E_ADMIN_PASSWORD;
const fixture = path.resolve(import.meta.dirname, 'fixtures', 'interactive.html');

test('Add file uploads HTML, renders it safely, and persists it across reload', async ({ page }) => {
  if (!password) throw new Error('DW_E2E_ADMIN_PASSWORD is required for the no-mock real-service suite.');
  const origin = new URL(process.env.DW_E2E_BASE_URL ?? 'https://app.localhost').origin;
  const headers = { Origin: origin };
  const login = await page.request.post('/api/dreamweave/v1/auth/sessions', { data: { email, password }, headers });
  expect(login.ok(), await login.text()).toBeTruthy();
  const project = await page.request.post('/api/dreamweave/v1/projects', { data: { title: 'browser HTML', summary: 'real HTML upload and persistence' }, headers });
  expect(project.ok(), await project.text()).toBeTruthy();
  const projectId = (await project.json() as { id?: unknown }).id;
  if (typeof projectId !== 'string') throw new Error('Project creation did not return an id.');

  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.goto(`/?projectId=${projectId}`);
  await expect(page.locator('.canvas-app__canvas')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', /\.html/);

  const uploadTicket = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/asset-uploads'));
  const uploadComplete = page.waitForResponse((response) => response.request().method() === 'POST' && /\/asset-uploads\/[^/]+\/complete$/.test(new URL(response.url()).pathname));
  const canvasCommand = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/canvas/commands'));
  const previewAccess = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/html-preview-access'));
  const previewDelivery = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/internal/asset-access/html-preview/'));

  await page.locator('input[type="file"]').setInputFiles(fixture);
  const [ticketResponse, completeResponse, commandResponse, accessResponse, deliveryResponse] = await Promise.all([
    uploadTicket,
    uploadComplete,
    canvasCommand,
    previewAccess,
    previewDelivery,
  ]);
  for (const response of [ticketResponse, completeResponse, commandResponse, accessResponse, deliveryResponse]) {
    expect(response.status(), `${response.request().method()} ${new URL(response.url()).pathname}`).toBe(200);
  }

  const node = page.locator('.dw-node').filter({ hasText: 'interactive.html' });
  await expect(node).toBeVisible();
  await expect(node.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(node.frameLocator('iframe').getByRole('heading', { name: 'HTML 渲染成功' })).toBeVisible();
  await expect(node.frameLocator('iframe').getByText('脚本执行成功')).toBeVisible();
  await expect(node.frameLocator('iframe').locator('body')).toHaveAttribute('data-script-executed', 'true');
  await node.frameLocator('iframe').getByRole('button', { name: '验证交互' }).click();
  await expect(node.frameLocator('iframe').getByText('按钮交互成功')).toBeVisible();
  await expect(node.frameLocator('iframe').locator('body')).toHaveAttribute('data-interaction-executed', 'true');

  const csp = deliveryResponse.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-src 'none'");
  expect(deliveryResponse.headers()['x-content-type-options']).toBe('nosniff');
  expect(deliveryResponse.headers()['cache-control']).toContain('no-store');

  const snapshot = await page.evaluate(async (id) => {
    const response = await fetch(`/api/dreamweave/v1/projects/${id}/canvas`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Canvas snapshot failed (${response.status}).`);
    return response.json() as Promise<{ nodes: Array<{ kind: string; title: string; assetId?: string }> }>;
  }, projectId);
  expect(snapshot.nodes).toEqual([
    expect.objectContaining({ kind: 'html', title: 'interactive.html', assetId: expect.any(String) }),
  ]);

  await page.reload();
  const restored = page.locator('.dw-node').filter({ hasText: 'interactive.html' });
  await expect(restored).toBeVisible();
  await expect(restored.frameLocator('iframe').getByRole('heading', { name: 'HTML 渲染成功' })).toBeVisible();
  await expect(restored.frameLocator('iframe').getByText('脚本执行成功')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
