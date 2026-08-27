import { expect, test } from '@playwright/test';

const sides = ['top', 'right', 'bottom', 'left'] as const;

function markdownNode(page: import('@playwright/test').Page) {
  return page.locator('.react-flow__node[data-id="markdown"]');
}

test('MN-02: code blocks use the light Playground editor and can change language', async ({ page }) => {
  await page.goto('/test/fixture-ui/?code-block=1&connection-pair=markdown,image');
  const node = await selectMarkdown(page);
  const frameElement = node.locator('iframe.dw-markdown-editor-frame');
  const frameBeforeEditing = await frameElement.boundingBox();
  if (!frameBeforeEditing) throw new Error('Markdown frame is not visible');
  await node.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  await expect(drawer).toBeVisible();
  const frame = drawer;
  const codeBlock = frame.locator('.milkdown-code-block');
  await expect(codeBlock.locator('.cm-editor')).toBeVisible();
  await expect(frame.locator('.milkdown')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(frame.locator('.ProseMirror')).toHaveCSS('caret-color', 'rgb(168, 168, 168)');
  await expect(codeBlock.locator('.cm-cursor').first()).toHaveCSS('border-left-color', 'rgb(168, 168, 168)');
  await expect(codeBlock.locator('.cm-cursor').first()).toHaveCSS('border-left-width', '1px');
  await expect(codeBlock).toHaveCSS('background-color', 'rgb(248, 249, 255)');
  await expect(codeBlock.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(248, 249, 255)');
  await expect(codeBlock.locator('.cm-activeLine')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(codeBlock.locator('.cm-gutters')).toBeHidden();
  await expect(codeBlock.locator('.cm-content')).toHaveCSS('font-size', '14px');
  await expect(codeBlock.locator('.cm-content')).toHaveCSS('line-height', '21px');

  const languageButton = codeBlock.locator('.language-button');
  const copyButton = codeBlock.locator('.copy-button');
  await codeBlock.hover();
  await expect(languageButton).toHaveText('js');
  await expect(languageButton).toHaveCSS('font-size', '9px');
  await expect(languageButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(copyButton).toHaveText('复制代码');
  await expect(copyButton).toHaveCSS('font-size', '0px');
  await expect(copyButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(copyButton.locator('svg')).toHaveCSS('width', '10px');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await copyButton.evaluate((element: HTMLElement) => element.click());
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('const dream = "weave";');
  const nodeHeightBeforePicker = await node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height));
  await languageButton.evaluate((element: HTMLElement) => element.click());
  await expect(languageButton).toHaveAttribute('data-expanded', 'true');
  const picker = codeBlock.locator('.language-picker');
  const [pickerBox, drawerBox] = await Promise.all([picker.boundingBox(), drawer.boundingBox()]);
  if (!pickerBox || !drawerBox) throw new Error('Code language picker is not visible');
  expect(pickerBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(pickerBox.y).toBeGreaterThanOrEqual(drawerBox.y);
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height);
  await expect.poll(() => node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBeCloseTo(nodeHeightBeforePicker, 3);
  await expect(picker.locator('.list-wrapper')).toHaveCSS('background-color', 'rgb(242, 243, 250)');
  await picker.locator('.search-input').fill('python');
  await picker.locator('.language-list-item[data-language="Python"]').click();
  await expect(languageButton).toHaveText('Python');
  await expect(languageButton).toHaveAttribute('data-expanded', 'false');
  await expect(frameElement).not.toHaveClass(/has-popup-viewport/);
});

async function selectMarkdown(page: import('@playwright/test').Page) {
  const node = markdownNode(page);
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await expect(node).toHaveClass(/selected/);
  return node;
}

test('MN-02b: second click opens a focused drawer editor and shifts the usable canvas viewport reversibly', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = markdownNode(page);
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await expect(node).toHaveClass(/selected/);
  const previewEditor = node.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');
  const viewport = page.locator('.react-flow__viewport');
  const readViewport = () => viewport.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
  const before = await readViewport();

  await node.locator('.dw-product-brief__interaction-overlay').click();
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(drawer).toBeVisible();
  await expect(previewEditor).toHaveAttribute('contenteditable', 'false');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  await expect.poll(async () => (await readViewport()).x).toBeLessThan(before.x - 250);

  await editor.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(node).toHaveClass(/selected/);
  await expect.poll(async () => Math.abs((await readViewport()).x - before.x)).toBeLessThan(4);
});

test('MN-02f: the drawer mounts its single Milkdown editor directly instead of in an iframe', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = markdownNode(page);
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await node.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toBeFocused();
  await expect(drawer.locator('iframe')).toHaveCount(0);
});

test('MN-02c: drawer drafts render in the selected text-node preview before the drawer closes', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = markdownNode(page);
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await node.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  const preview = node.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.pressSequentially(' 实时预览');
  await expect(preview).toContainText('实时预览');
  await expect(drawer).toBeVisible();
});

test('MN-02e: drawer follows the selected text node and closes when no text node is selected', async ({ page }) => {
  await page.goto('/test/fixture-ui/?markdown-pair=1&connection-pair=markdown,markdown-b');
  const first = markdownNode(page);
  const second = page.locator('.react-flow__node[data-id="markdown-b"]');
  await first.locator('.dw-product-brief__interaction-overlay').click();
  await first.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toContainText('Dream Weave');

  // Bring the distant second node into the remaining canvas area before
  // selecting it: the open drawer intentionally owns the right edge.
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  await page.mouse.move(paneBox.x + 600, paneBox.y + paneBox.height - 80);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(paneBox.x + 120, paneBox.y + paneBox.height - 80, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await second.locator('.dw-product-brief__interaction-overlay').click();
  await expect(first).not.toHaveClass(/selected/);
  await expect(second).toHaveClass(/selected/);
  await expect(editor).toContainText('连接目标');
  await expect(editor).toBeFocused();

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await expect(second).not.toHaveClass(/selected/);
  await expect(drawer).toHaveCount(0);
});

test('MN-02d: ordered, unordered, and task lists keep Crepe Playground layout metrics', async ({ page }) => {
  await page.goto('/test/fixture-ui/?list-blocks=1');
  const node = markdownNode(page);
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await node.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  const frame = drawer;
  const lists = frame.locator('.ProseMirror ul, .ProseMirror ol');
  await expect(lists).toHaveCount(3);
  await expect(lists.first()).toHaveCSS('padding-left', '0px');
  await expect(lists.first()).toHaveCSS('margin-top', '0px');
  const listParagraph = frame.locator('.milkdown-list-item-block p').first();
  await expect(listParagraph).toHaveCSS('font-size', '16px');
  await expect(listParagraph).toHaveCSS('line-height', '24px');
  await expect(listParagraph).toHaveCSS('padding-top', '4px');
  const taskItem = frame.locator('.milkdown-list-item-block li').last();
  const taskLabel = taskItem.locator('.label-wrapper');
  await expect(taskItem).toHaveCSS('gap', '10px');
  await expect(taskLabel).toHaveCSS('width', '24px');
  await expect(taskLabel).toHaveCSS('height', '32px');
});

test('MN-03: text nodes use a fixed default width and expose no manual resize controls', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=markdown,image');
  const node = await selectMarkdown(page);
  await expect(node.locator('.react-flow__resize-control')).toHaveCount(0);
  await expect(node).toHaveCSS('width', '550px');
});

test('MN-05: title and readonly content drag the node, while drawer editing protects text selection from node dragging', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=markdown,image');
  const node = markdownNode(page);
  const title = node.locator('.dw-product-brief__header');
  await expect(title).toHaveAttribute('data-drag-handle', 'true');
  const before = await node.boundingBox(); const titleBox = await title.boundingBox();
  if (!before || !titleBox) throw new Error('Text node title is not visible');
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2); await page.mouse.down(); await page.mouse.move(titleBox.x + titleBox.width / 2 + 100, titleBox.y + titleBox.height / 2 + 60, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())?.x).toBeGreaterThan(before.x + 70);
  const overlay = node.locator('.dw-product-brief__interaction-overlay');
  await expect(overlay).toHaveAttribute('data-drag-handle', 'true');
  const contentBefore = await node.boundingBox(); const overlayBox = await overlay.boundingBox();
  if (!contentBefore || !overlayBox) throw new Error('Readonly text overlay is not visible');
  await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2); await page.mouse.down(); await page.mouse.move(overlayBox.x + overlayBox.width / 2 + 80, overlayBox.y + overlayBox.height / 2 + 40, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())?.x).toBeGreaterThan(contentBefore.x + 50);
  await overlay.click();
  const drawer = page.locator('[data-canvas-side-drawer]');
  await expect(drawer).toBeVisible();
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.waitForTimeout(220);
  const editBefore = await node.boundingBox(); const editorBox = await editor.boundingBox();
  if (!editBefore || !editorBox) throw new Error('Markdown editor is not visible');
  await page.mouse.move(editorBox.x + 90, editorBox.y + 45); await page.mouse.down(); await page.mouse.move(editorBox.x + 220, editorBox.y + 45, { steps: 8 }); await page.mouse.up();
  const editAfter = await node.boundingBox();
  expect(editAfter?.x).toBeCloseTo(editBefore.x, 2); expect(editAfter?.y).toBeCloseTo(editBefore.y, 2);
});

test('MN-06: every markdown source and target handle combination creates one connection without entering edit mode', async ({ page }) => {
  test.setTimeout(90_000);
  for (const sourceSide of sides) for (const targetSide of sides) {
    await page.goto('/test/fixture-ui/?markdown-pair=1&connection-pair=markdown,markdown-b');
    const sourceNode = markdownNode(page); const targetNode = page.locator('.react-flow__node[data-id="markdown-b"]');
    await expect(sourceNode.locator('.dw-connection-handle')).toHaveCount(4);
    const source = sourceNode.locator(`.dw-connection-handle--${sourceSide}`); const target = targetNode.locator(`.dw-connection-handle--${targetSide}`);
    await expect(source).toHaveAttribute('aria-label', `从${({ top: '上', right: '右', bottom: '下', left: '左' } as const)[sourceSide]}侧连接`);
    const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
    if (!sourceBox || !targetBox) throw new Error(`Missing ${sourceSide} -> ${targetSide} connection handles`);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2); await page.mouse.down(); await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 }); await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(sourceNode.locator('.dw-product-brief__interaction-overlay')).toBeVisible();
    await expect(sourceNode.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  }
});

test('MN-07: duplicate selects a positioned markdown copy and delete removes only that copy', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=markdown,image');
  const source = await selectMarkdown(page);
  const before = await source.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }));
  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  await toolbar.getByRole('button', { name: '复制一份' }).click();
  await expect(page.locator('.dw-node[data-node-kind="markdown"]')).toHaveCount(2);
  const selected = page.locator('.react-flow__node.selected').filter({ has: page.locator('.dw-node[data-node-kind="markdown"]') });
  await expect(selected).toHaveCount(1);
  const copy = selected;
  const copyPosition = await copy.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }));
  expect(copyPosition.x).toBe(before.x + 32); expect(copyPosition.y).toBe(before.y + 32);
  await page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.dw-node[data-node-kind="markdown"]')).toHaveCount(1);
  await expect(source).toBeVisible();
});

test('MN-08: bottom-toolbar text placement preview and node stay centred on the pointer', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const existingIds = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const target = { x: paneBox.x + paneBox.width - 280, y: paneBox.y + paneBox.height - 180 };

  await page.getByRole('button', { name: '添加文本' }).click();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  const preview = page.locator('.dw-placement-draft--markdown');
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  if (!previewBox) throw new Error('Markdown placement preview is not visible');
  expect(previewBox.x + previewBox.width / 2).toBeCloseTo(target.x, 1);
  expect(previewBox.y + previewBox.height / 2).toBeCloseTo(target.y, 1);

  await page.mouse.click(target.x, target.y);
  await expect(preview).toHaveCount(0);
  await expect.poll(async () => {
    const ids = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
    return ids.find((id) => id !== null && !existingIds.includes(id)) ?? null;
  }).not.toBeNull();
  const finalId = await page.locator('.react-flow__node').evaluateAll((nodes, ids) => nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !ids.includes(id)), existingIds);
  if (!finalId) throw new Error('Text node was not created');
  const finalBox = await page.locator(`.react-flow__node[data-id="${finalId}"]`).boundingBox();
  if (!finalBox) throw new Error('Placed text node is not visible');
  expect(finalBox.x + finalBox.width / 2).toBeCloseTo(target.x, 1);
  expect(finalBox.y + finalBox.height / 2).toBeCloseTo(target.y, 1);
});
