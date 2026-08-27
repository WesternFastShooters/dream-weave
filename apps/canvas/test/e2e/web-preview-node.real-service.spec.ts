import { expect, test } from '@playwright/test';

const email = process.env.DW_E2E_ADMIN_EMAIL ?? 'ci-admin@example.test';
const password = process.env.DW_E2E_ADMIN_PASSWORD;
const previewUrl = process.env.DW_E2E_WEB_PREVIEW_URL ?? 'https://preview.test/interactive.html';

test('WP-02 real-service: CreateWebAsset, canvas create, snapshot, and reload retain a web preview', async ({ page }) => {
  test.skip(!password, 'DW_E2E_ADMIN_PASSWORD is required for the no-mock real-service suite.');
  await page.route('**/interactive.html', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><p>预览加载成功</p><button id="counter">计数 0</button><script>counter.onclick = () => counter.textContent = "计数 1";</script></body>' });
  });

  const origin = new URL(process.env.DW_E2E_ORIGIN ?? process.env.DW_E2E_BASE_URL ?? 'http://127.0.0.1:4179').origin;
  const headers = { Origin: origin };
  const login = await page.request.post('/api/dreamweave/v1/auth/sessions', { data: { email, password }, headers });
  expect(login.ok(), await login.text()).toBeTruthy();
  const project = await page.request.post('/api/dreamweave/v1/projects', { data: { title: 'web preview', summary: 'real service test' }, headers });
  expect(project.ok(), await project.text()).toBeTruthy();
  const projectId = (await project.json() as { id?: string }).id;
  if (!projectId) throw new Error('Project creation did not return an id.');

  await page.goto(`/?projectId=${projectId}`);
  const pane = page.locator('.react-flow__pane'); await expect(pane).toBeVisible();
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const webAssetResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/web-assets'));
  const canvasResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/canvas/commands'));

  await page.getByRole('button', { name: '添加网页预览' }).click();
  await page.mouse.move(paneBox.x + 480, paneBox.y + 340); await page.mouse.click(paneBox.x + 480, paneBox.y + 340);
  const form = page.locator('.dw-placement-draft--web:not(.dw-placement-draft--moving)');
  await form.getByRole('textbox').fill(previewUrl);
  await form.getByRole('button', { name: '立即预览' }).click();

  const [assetResponse, commandResponse] = await Promise.all([webAssetResponse, canvasResponse]);
  expect(assetResponse.ok(), await assetResponse.text()).toBeTruthy();
  expect(commandResponse.ok(), await commandResponse.text()).toBeTruthy();
  expect(assetResponse.request().postDataJSON()).toMatchObject({ projectId, url: previewUrl, displayName: new URL(previewUrl).hostname });
  expect(commandResponse.request().postDataJSON()).toMatchObject({ mutations: [expect.objectContaining({ createAssetNode: expect.objectContaining({ placement: expect.objectContaining({ width: 520, height: 360 }) }) })] });

  const node = page.locator('.dw-node[data-node-kind="web-preview"]');
  await expect(node).toBeVisible();
  const frame = node.locator('iframe.dw-web-preview-frame');
  await expect(frame).toHaveAttribute('src', previewUrl);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(node.frameLocator('iframe.dw-web-preview-frame').getByText('预览加载成功')).toBeVisible();

  const snapshotResponse = await page.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`);
  expect(snapshotResponse.ok(), await snapshotResponse.text()).toBeTruthy();
  const snapshot = await snapshotResponse.json() as { nodes: Array<{ id: string; kind: string; title: string; assetId?: string; renderData?: { webPreview?: { url?: string } } }>; placements: Array<{ nodeId: string; width: number; height: number }> };
  const saved = snapshot.nodes.find((item) => item.kind === 'web-preview');
  expect(saved).toMatchObject({ kind: 'web-preview', title: new URL(previewUrl).hostname, assetId: expect.any(String), renderData: { webPreview: { url: previewUrl } } });
  expect(snapshot.placements.find((placement) => placement.nodeId === saved?.id)).toMatchObject({ width: 520, height: 360 });

  await page.reload();
  const restored = page.locator('.dw-node[data-node-kind="web-preview"]');
  await expect(restored).toBeVisible();
  await expect(restored.locator('iframe.dw-web-preview-frame')).toHaveAttribute('src', previewUrl);
  await expect(restored.frameLocator('iframe.dw-web-preview-frame').getByText('预览加载成功')).toBeVisible();
});

test.skip('WP-06 real-service: iframe interaction reaches the controlled counter after an explicit second click', async () => {
  // Unskip with the fixture counterpart when WebPreviewNode implements the
  // documented two-phase interaction contract.
});
