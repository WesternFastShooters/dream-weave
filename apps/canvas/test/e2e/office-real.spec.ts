import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const baseURL = process.env.DW_E2E_BASE_URL ?? 'https://app.localhost';
const apiBaseURL = process.env.DW_E2E_API_BASE_URL ?? baseURL;
const appOrigin = process.env.DW_E2E_APP_ORIGIN ?? 'https://app.localhost';
const email = process.env.DW_E2E_ADMIN_EMAIL ?? 'ci-admin@example.test';
const password = process.env.DW_E2E_ADMIN_PASSWORD;
const fixtures = [
  { name: 'fixture.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', documentType: 'word' },
  { name: 'fixture.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'office', documentType: 'cell' },
  { name: 'fixture.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office', documentType: 'slide' },
  { name: 'fixture.pdf', mime: 'application/pdf', kind: 'pdf', documentType: 'pdf' },
];

function localEndpoint(url: string): { url: string; host?: string } {
  const endpoint = new URL(url);
  const localBase = new URL(apiBaseURL);
  if (endpoint.origin !== appOrigin || localBase.origin === appOrigin) return { url };
  const host = endpoint.host;
  endpoint.protocol = localBase.protocol;
  endpoint.host = localBase.host;
  return { url: endpoint.toString(), host };
}

function apiURL(path: string): string { return new URL(path, apiBaseURL).toString(); }

test('real ONLYOFFICE opens DOCX, XLSX, PPTX, and PDF read-only through the private source proxy', async ({ browser }) => {
  if (!password) throw new Error('DW_E2E_ADMIN_PASSWORD is required for the real Office suite.');
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const failedOfficeRequests: string[] = [];
  const officeConsoleMessages: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().includes('dream-weave-host')) failedOfficeRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') officeConsoleMessages.push(`${message.location().url}: ${message.text()}`);
  });
  const sameOriginHeaders = { Origin: appOrigin };
  const login = await page.request.post(apiURL('/api/dreamweave/v1/auth/sessions'), { data: { email, password }, headers: sameOriginHeaders });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post(apiURL('/api/dreamweave/v1/projects'), { data: { title: 'office real fixtures', summary: 'created by the Office E2E suite' }, headers: sameOriginHeaders });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json() as { id: string }).id;
  if (!projectId) throw new Error('Office fixture project creation did not return an id.');
  const fixtureDirectory = process.env.DW_E2E_OFFICE_FIXTURE_DIR;
  const temporaryDirectory = fixtureDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'dream-weave-office-'));
  try {
    if (!fixtureDirectory) execFileSync('python3', [path.resolve(import.meta.dirname, 'create-office-fixtures.py'), temporaryDirectory], { stdio: 'inherit' });
    const assets: { id: string; fixture: typeof fixtures[number] }[] = [];
    for (const fixture of fixtures) {
      const body = await readFile(path.join(temporaryDirectory, fixture.name));
      const ticket = await page.request.post(apiURL(`/api/dreamweave/v1/projects/${projectId}/asset-uploads`), { data: { projectId, fileName: fixture.name, declaredMimeType: fixture.mime, byteSize: body.byteLength }, headers: sameOriginHeaders });
      expect(ticket.ok(), `create ${fixture.name} upload ticket`).toBeTruthy();
      const upload = await ticket.json() as { uploadId: string; uploadUrl: string; requiredHeaders: Record<string, string> };
      const uploadEndpoint = localEndpoint(upload.uploadUrl);
      const put = await page.request.fetch(uploadEndpoint.url, { method: 'PUT', data: body, headers: { ...upload.requiredHeaders, 'Content-Type': fixture.mime, ...sameOriginHeaders, ...(uploadEndpoint.host ? { Host: uploadEndpoint.host } : {}) } });
      expect(put.ok(), `upload ${fixture.name}`).toBeTruthy();
      const complete = await page.request.post(apiURL(`/api/dreamweave/v1/projects/${projectId}/asset-uploads/${upload.uploadId}/complete`), { data: { projectId, uploadId: upload.uploadId }, headers: sameOriginHeaders });
      expect(complete.ok(), `complete ${fixture.name}`).toBeTruthy();
      const asset = await complete.json() as { id: string; kind: string; processingState: string };
      expect(asset).toMatchObject({ id: expect.any(String), kind: fixture.kind, processingState: 'ready' });
      assets.push({ id: asset.id, fixture });
    }
    for (const { id: assetId, fixture } of assets) {
      const response = await page.request.post(apiURL(`/api/dreamweave/v1/projects/${projectId}/assets/${assetId}/office-sessions`), { headers: sameOriginHeaders });
      expect(response.ok()).toBeTruthy();
      const session = await response.json() as { sessionId: string; documentServerUrl: string; documentUrl: string; documentKey: string; token: string; documentTitle: string; fileType: string; documentType: string; expiresAt: string };
      expect(session.documentUrl).toContain('/internal/office-source/');
      expect(session.fileType).toBe(fixture.name.split('.').at(-1));
      expect(session.documentType).toBe(fixture.documentType);
      expect(session.token.split('.')).toHaveLength(3);
      const signedConfig = JSON.parse(Buffer.from(session.token.split('.')[1]!, 'base64url').toString()) as { type?: string; editorConfig?: { mode?: string; embedded?: { autostart?: string } } };
      expect(signedConfig).toMatchObject({ type: 'embedded', editorConfig: { mode: 'view', embedded: { autostart: 'document' } } });
      await page.goto(`${new URL(session.documentServerUrl).origin}/dw-viewer-shell/${encodeURIComponent(session.sessionId)}`);
      // DocsAPI replaces the mount element while it initializes. The sole
      // iframe is the actual Document Server editor frame.
      const editorFrame = page.locator('iframe').first();
      await expect(editorFrame).toHaveCount(1, { timeout: 40_000 });
      const layout = await editorFrame.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      });
      expect(layout.width).toBeCloseTo(layout.viewportWidth, 0);
      expect(layout.height).toBeCloseTo(layout.viewportHeight, 0);
    }

    // The session API proves the document server accepts every Office format.
    // Render one representative Office file and the PDF through the canvas as
    // well: this verifies the product's node shell, ready handshake, and
    // two-click handoff to the embedded viewer rather than only its endpoint.
    const canvasAssets = assets
      .filter(({ fixture }) => fixture.name === 'fixture.docx' || fixture.name === 'fixture.pdf')
      .map((asset) => ({ ...asset, nodeId: crypto.randomUUID() }));
    const seeded = await page.request.post(apiURL(`/api/dreamweave/v1/projects/${projectId}/canvas/commands`), {
      headers: sameOriginHeaders,
      data: {
        expectedRevision: '0',
        requestId: crypto.randomUUID(),
        mutations: canvasAssets.map(({ id: assetId, nodeId }, index) => ({
          createAssetNode: {
            nodeId,
            assetId,
            placement: { nodeId, x: 120 + index * 640, y: 160, width: 520, height: 560, zIndex: index + 1 },
          },
        })),
      },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();

    await page.goto(`${appOrigin}/?projectId=${projectId}`);
    await expect(page.locator('.canvas-app__canvas')).toBeVisible();
    for (const { fixture } of canvasAssets) {
      const documentLabel = fixture.kind === 'pdf' ? 'PDF' : 'Office';
      const node = page.locator('.dw-node').filter({ hasText: fixture.name });
      const flowNode = node.locator('xpath=..');
      const viewer = node.locator('.dw-onlyoffice-frame');
      await expect(node).toBeVisible();
      await expect(viewer).toHaveAttribute('src', /\/dw-viewer-shell\//);
      await expect(viewer).toHaveClass(/dw-onlyoffice-frame--ready/, { timeout: 40_000 });
      await expect(viewer.contentFrame().locator('iframe').first()).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');

      const overlay = node.getByLabel(`选择或拖拽${documentLabel}节点`);
      await overlay.click();
      await expect(flowNode).toHaveClass(/selected/);
      await overlay.click();
      await expect(viewer).toHaveClass(/dw-onlyoffice-frame--interactive/);
      await expect(viewer).toHaveAttribute('aria-hidden', 'false');
      await expect(viewer).toHaveCSS('pointer-events', 'auto');
    }
  } finally {
    if (!fixtureDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
  await context.close();
});
