import { expect, test } from '@playwright/test';
import path from 'node:path';

const email = process.env.DW_E2E_ADMIN_EMAIL ?? 'admin@example.test';
const password = process.env.DW_E2E_ADMIN_PASSWORD;
const fixture = (name: string) => path.resolve(import.meta.dirname, 'fixtures', name);

test('real browser uploads, plays, pauses, and seeks audio and video nodes', async ({ page }) => {
  if (!password) throw new Error('DW_E2E_ADMIN_PASSWORD is required for the no-mock real-service suite.');
  const origin = new URL(process.env.DW_E2E_BASE_URL ?? 'https://app.localhost').origin;
  const login = await page.request.post('/api/dreamweave/v1/auth/sessions', { data: { email, password }, headers: { Origin: origin } });
  expect(login.ok()).toBeTruthy();
  const token = /(?:^|,)\s*dw_session=([^;]+)/.exec(login.headers()['set-cookie'] ?? '')?.[1];
  if (!token) throw new Error('Login did not issue a session cookie.');
  const base = new URL(origin);
  await page.context().addCookies([{ name: 'dw_session', value: token, domain: base.hostname, path: '/api/dreamweave/v1', httpOnly: true, secure: base.protocol === 'https:', sameSite: 'Lax' }]);
  const project = await page.request.post('/api/dreamweave/v1/projects', { data: { title: 'browser media', summary: 'real audio and video interaction' }, headers: { Origin: origin } });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json()).id as string;

  let playbackAccessRequests = 0;
  page.on('request', (request) => { if (request.url().includes('/playback-access')) playbackAccessRequests += 1; });
  await page.goto(`/?projectId=${projectId}`);
  await expect(page.locator('.canvas-app__canvas')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([fixture('tone.mp3'), fixture('clip.mp4')]);

  const audio = page.locator('.dw-node').filter({ has: page.getByRole('slider', { name: '音频进度' }) });
  const video = page.locator('.dw-node').filter({ has: page.getByRole('slider', { name: '视频进度' }) });
  await expect(audio).toBeVisible({ timeout: 30_000 });
  await expect(video).toBeVisible({ timeout: 30_000 });
  expect(playbackAccessRequests).toBe(0);

  const canvas = await page.request.get(`/api/dreamweave/v1/projects/${projectId}/canvas`);
  expect(canvas.ok()).toBeTruthy();
  const assetIds = (await canvas.json() as { nodes: Array<{ assetId?: string }> }).nodes.map((node) => node.assetId).filter((id): id is string => Boolean(id));
  expect(assetIds).toHaveLength(2);
  for (const assetId of assetIds) {
    const access = await page.request.post(`/api/dreamweave/v1/projects/${projectId}/assets/${assetId}/playback-access`, { data: { projectId, assetId } });
    expect(access.ok()).toBeTruthy();
    const { url } = await access.json() as { url: string };
    const head = await page.request.head(url);
    expect(head.status()).toBe(200);
    expect(head.headers()['accept-ranges']).toBe('bytes');
    expect(head.headers()['etag']).toBeTruthy();
    expect(head.headers()['last-modified']).toBeTruthy();
    const partial = await page.request.get(url, { headers: { Range: 'bytes=0-15' } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()['content-range']).toMatch(/^bytes 0-15\//);
    const unsatisfiable = await page.request.get(url, { headers: { Range: 'bytes=999999999-' } });
    expect(unsatisfiable.status()).toBe(416);
    expect(unsatisfiable.headers()['content-range']).toMatch(/^bytes \*\//);
  }

  const audioProgress = audio.getByRole('slider', { name: '音频进度' });
  await audio.getByRole('button', { name: '播放音频' }).click();
  await expect(audioProgress).toBeEnabled({ timeout: 30_000 });
  await expect(audio.getByRole('button', { name: '暂停音频' })).toBeVisible();
  await audioProgress.fill('1000');
  await expect(audioProgress).toHaveValue('1000');
  await expect.poll(() => audio.locator('audio').evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(0.9);
  await audio.getByRole('button', { name: '暂停音频' }).click();
  await expect(audio.getByRole('button', { name: '播放音频' })).toBeVisible();

  const videoProgress = video.getByRole('slider', { name: '视频进度' });
  await video.getByRole('button', { name: '播放视频' }).click();
  await expect(video.locator('video')).toBeVisible();
  await expect(videoProgress).toBeEnabled({ timeout: 30_000 });
  await expect(video.getByRole('button', { name: '暂停视频' })).toBeVisible();
  await videoProgress.focus();
  await videoProgress.press('End');
  await expect.poll(() => videoProgress.inputValue()).not.toBe('0');
  const videoSeekValue = Number(await videoProgress.inputValue());
  await expect.poll(() => video.locator('video').evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(videoSeekValue / 1000 - 0.1);
  await video.getByRole('button', { name: '暂停视频' }).click();
  await expect(video.getByRole('button', { name: '播放视频' })).toBeVisible();
  await video.getByRole('button', { name: '播放视频' }).click();
  await expect(video.getByRole('button', { name: '暂停视频' })).toBeVisible();
  expect(playbackAccessRequests).toBe(2);

  await page.reload();
  await expect(page.getByRole('button', { name: '播放音频' })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放视频' })).toBeVisible();
  expect(playbackAccessRequests).toBe(2);
});
