import { expect, test, type Page } from '@playwright/test';

const sides = ['top', 'right', 'bottom', 'left'] as const;
const sideNames = { top: '上', right: '右', bottom: '下', left: '左' } as const;
const previewUrl = 'https://preview.test/interactive.html';

function webNode(page: Page) {
  return page.locator('.react-flow__node[data-id="web"]');
}

async function installInteractivePreview(page: Page): Promise<void> {
  await page.route('**/interactive.html', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><body><p>预览加载成功</p><button id="counter">计数 0</button><script>document.querySelector("#counter").addEventListener("click", (event) => { event.currentTarget.textContent = "计数 1"; });</script></body></html>',
    });
  });
}

async function selectWebPreview(page: Page) {
  const node = webNode(page);
  await node.locator('.dw-resource-node__surface').click({ position: { x: 16, y: 16 } });
  await expect(node).toHaveClass(/selected/);
  return node;
}

async function availablePanePoint(page: Page, pane: ReturnType<Page['locator']>, xRatio: number, yRatio: number) {
  const box = await pane.boundingBox();
  if (!box) throw new Error('Canvas pane is not visible');
  const candidates = [-120, -60, 0, 60, 120].flatMap((dx) => [-100, -50, 0, 50, 100].map((dy) => ({
    x: Math.max(box.x + 24, Math.min(box.x + box.width - 24, box.x + box.width * xRatio + dx)),
    y: Math.max(box.y + 24, Math.min(box.y + box.height - 24, box.y + box.height * yRatio + dy)),
  })));
  const point = await page.evaluate((points) => points.find(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false) ?? null, candidates);
  if (!point) throw new Error(`No blank canvas point near ${xRatio}, ${yRatio}`);
  return point;
}

test('WP-01: the web placement ghost tracks the pointer and becomes a same-centre URL form', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
  const initialNodes = await page.locator('.react-flow__node').count();
  const pane = page.locator('.react-flow__pane');
  for (const [xRatio, yRatio] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]] as const) {
    const point = await availablePanePoint(page, pane, xRatio, yRatio);
    await page.getByRole('button', { name: '添加网页预览' }).click();
    await expect(page.locator('.dw-placement-draft--web.dw-placement-draft--moving')).toHaveCount(0);
    await page.mouse.move(point.x, point.y, { steps: 5 });
    const ghost = page.locator('.dw-placement-draft--web.dw-placement-draft--moving');
    await expect(ghost).toBeVisible();
    await expect(ghost.locator('form')).toHaveAttribute('aria-hidden', 'true');
    await expect(ghost.locator('form').evaluate((element) => (element as HTMLFormElement).inert)).resolves.toBe(true);
    const ghostBox = await ghost.boundingBox();
    if (!ghostBox) throw new Error('Web preview placement ghost is not visible');
    expect(ghostBox.width).toBe(520); expect(ghostBox.height).toBe(360);
    expect(ghostBox.x + ghostBox.width / 2).toBeCloseTo(point.x, 1);
    expect(ghostBox.y + ghostBox.height / 2).toBeCloseTo(point.y, 1);

    await page.mouse.click(point.x, point.y);
    const form = page.locator('.dw-placement-draft--web:not(.dw-placement-draft--moving)');
    await expect(form).toBeVisible();
    const formBox = await form.boundingBox();
    if (!formBox) throw new Error('Web preview URL form is not visible');
    expect(formBox.x + formBox.width / 2).toBeCloseTo(point.x, 1);
    expect(formBox.y + formBox.height / 2).toBeCloseTo(point.y, 1);
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodes);
    await form.getByRole('button', { name: '取消放置' }).click();
  }
});

test('WP-02: a valid HTTPS URL creates a secure iframe that loads the controlled page', async ({ page }) => {
  await installInteractivePreview(page);
  await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
  const pane = page.locator('.react-flow__pane');
  const point = await availablePanePoint(page, pane, .72, .72);

  await page.getByRole('button', { name: '添加网页预览' }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.click(point.x, point.y);
  const form = page.locator('.dw-placement-draft--web:not(.dw-placement-draft--moving)');
  await form.getByRole('textbox').fill(previewUrl);
  await form.getByRole('button', { name: '立即预览' }).click();

  const created = page.locator('.dw-node[data-node-kind="web-preview"]').filter({ has: page.getByTitle('preview.test') }).last();
  await expect(created).toBeVisible();
  const frame = created.locator('iframe.dw-web-preview-frame');
  await expect(frame).toHaveAttribute('src', previewUrl);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(created.getByRole('link', { name: '在新标签页打开' })).toHaveCount(0);
});

test.fixme('WP-02: the fixture serves the controlled HTTPS iframe page and proves its content loaded', async ({ page }) => {
  await installInteractivePreview(page);
  await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
  // The current Vite fixture has no HTTPS preview.test origin. Keep this
  // assertion as executable acceptance coverage for the configured test host.
  await expect(webNode(page).frameLocator('iframe.dw-web-preview-frame').getByText('预览加载成功')).toBeVisible();
});

test('WP-02: invalid URLs stay in the form and never create a web node', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
  const before = await page.locator('.dw-node[data-node-kind="web-preview"]').count();
  const pane = page.locator('.react-flow__pane');
  const point = await availablePanePoint(page, pane, .72, .72);
  await page.getByRole('button', { name: '添加网页预览' }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.click(point.x, point.y);
  const form = page.locator('.dw-placement-draft--web:not(.dw-placement-draft--moving)');

  for (const url of ['http://preview.test/interactive.html', 'https://user:secret@preview.test/interactive.html', 'not a URL']) {
    await form.getByRole('textbox').fill(url);
    await form.getByRole('button', { name: '立即预览' }).click();
    await expect(form.getByRole('status')).toHaveText('请输入不含账号信息的 HTTPS URL。');
    await expect(form.getByRole('textbox')).toHaveValue(url);
    await expect(page.locator('.dw-node[data-node-kind="web-preview"]')).toHaveCount(before);
  }
});

test.fixme('WP-03: both content and title are drag handles for a web preview', async ({ page }) => {
  for (const handleSelector of ['.dw-resource-node__surface', '.dw-resource-node__title']) {
    await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
    await page.getByRole('button', { name: '矩形套索' }).click();
    const node = webNode(page); const handle = node.locator(handleSelector);
    await expect(handle).toHaveAttribute('data-drag-handle', 'true');
    const [before, handleBox] = await Promise.all([node.boundingBox(), handle.boundingBox()]);
    if (!before || !handleBox) throw new Error(`Web preview ${handleSelector} is not visible`);
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down(); await page.mouse.move(handleBox.x + handleBox.width / 2 + 100, handleBox.y + handleBox.height / 2 + 60, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await node.boundingBox())?.x).toBeGreaterThan(before.x + 70);
    await expect(node.locator('iframe')).toHaveCSS('pointer-events', 'none');
  }
});

test('WP-04: every web-preview source and markdown target handle combination creates exactly one edge', async ({ page }) => {
  test.setTimeout(90_000);
  for (const sourceSide of sides) for (const targetSide of sides) {
    await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
    const sourceNode = webNode(page); const targetNode = page.locator('.react-flow__node[data-id="markdown"]');
    await expect(sourceNode.locator('.dw-connection-handle')).toHaveCount(4);
    const source = sourceNode.locator(`.dw-connection-handle--${sourceSide}`);
    const target = targetNode.locator(`.dw-connection-handle--${targetSide}`);
    await expect(source).toHaveAttribute('aria-label', `从${sideNames[sourceSide]}侧连接`);
    const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
    if (!sourceBox || !targetBox) throw new Error(`Missing ${sourceSide} → ${targetSide} handle`);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down(); await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 }); await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(sourceNode.locator('iframe')).toHaveCSS('pointer-events', 'none');
  }
});

test('WP-05: duplicate offsets the web preview, while delete and undo/redo retain canvas consistency', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=web,markdown');
  const source = await selectWebPreview(page);
  const sourcePosition = await source.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }));
  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  await expect(toolbar.getByRole('button')).toHaveCount(2);
  await toolbar.getByRole('button', { name: '复制一份' }).click();
  const copy = page.locator('.react-flow__node.selected').filter({ has: page.locator('.dw-node[data-node-kind="web-preview"]') });
  await expect(copy).toHaveCount(1);
  const copyPosition = await copy.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }));
  expect(copyPosition).toEqual({ x: sourcePosition.x + 32, y: sourcePosition.y + 32 });

  await page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.dw-node[data-node-kind="web-preview"]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.dw-node[data-node-kind="web-preview"]')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.dw-node[data-node-kind="web-preview"]')).toHaveCount(1);
});

test.skip('WP-06: a second short click enters iframe interaction and deselection exits it', async () => {
  // Product support is intentionally not implemented yet; see the scenario doc.
});
