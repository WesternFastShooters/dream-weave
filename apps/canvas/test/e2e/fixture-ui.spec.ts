import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixtureNodeIds = ['markdown', 'image', 'audio', 'video', 'web', 'html', 'pdf', 'office', 'frame'] as const;
const connectionSides = ['top', 'right', 'bottom', 'left'] as const;
const oppositeSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;

async function expectPreviewEndpointAt(page: Page, target: { x: number; y: number }) {
  const endpoint = await page.locator('path.dw-connection-preview').evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength());
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    };
  });
  if (!endpoint) throw new Error('Connection preview does not have a screen transform');
  expect(Math.abs(endpoint.x - target.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(endpoint.y - target.y)).toBeLessThanOrEqual(4);
}

test('fixture projects all nine product nodes and has no test renderer', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await expect(page.locator('.canvas-app__canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await expect(page.getByText('Test node')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(5);
  await expect(page.locator('iframe').nth(0)).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('iframe').nth(0)).toHaveAttribute('src', /\/markdown-editor-frame\.html\?session=/);
  await expect(page.locator('iframe').nth(1)).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('iframe').nth(2)).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('iframe').nth(3)).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect(page.locator('iframe').nth(4)).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
});

test('connection tool creates a floating line then returns to the pointer tool', async ({ page }) => {
  await page.goto('/test/fixture-ui/?empty');
  const canvas = page.locator('.canvas-app__canvas');
  const tool = page.getByRole('toolbar', { name: '画布工具' }).getByRole('button', { name: '连线工具' });
  const pointerTool = page.getByRole('toolbar', { name: '画布工具' }).getByRole('button', { name: '矩形套索' });
  await expect(page.locator('.dw-connection-handle')).toHaveCount(0);
  await expect(tool).toHaveAttribute('data-tooltip', '连线工具 C');
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await page.mouse.move(box.x + box.width * .62, box.y + box.height * .36);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-connection-drawing', 'true');
  await page.mouse.move(box.x + box.width * .82, box.y + box.height * .64, { steps: 8 });
  await page.mouse.up();
  const edge = page.locator('.dw-floating-connection');
  await expect(edge).toHaveCount(1);
  await expect(edge).toBeVisible();
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  await expect(pointerTool).toHaveAttribute('aria-pressed', 'true');
  const toolbar = page.getByRole('toolbar', { name: '连接线操作' });
  await expect(toolbar).toBeVisible();

  // A floating line keeps the same selected-state controls as a node-to-node
  // connection. The rectangle lasso must also select a line that it crosses.
  await pointerTool.click();
  await page.locator('.react-flow__pane').click({ position: { x: 24, y: 24 } });
  await expect(toolbar).toHaveCount(0);
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .7, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  await expect(page.locator('.dw-floating-connection-endpoint')).toHaveCount(2);
  await page.locator('.react-flow__pane').click({ position: { x: 24, y: 24 } });
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .3, { steps: 3 });
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .7, { steps: 3 });
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * .7, { steps: 3 });
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * .3, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(toolbar).toBeVisible();

  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '直线' }).click();
  await expect(edge).toHaveAttribute('d', /^M[^C]*L/);
  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '曲线' }).click();
  await expect(edge).toHaveAttribute('d', /C/);
  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '折线' }).click();
  await expect(edge).toHaveAttribute('d', /^M[^C]*L.*L/);
  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '实线' }).click();
  await expect(edge).not.toHaveAttribute('stroke-dasharray');
  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '虚线' }).click();
  await expect(edge).toHaveAttribute('stroke-dasharray', '7 5');
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '无方向' }).click();
  await expect(edge).not.toHaveAttribute('marker-start');
  await expect(edge).not.toHaveAttribute('marker-end');
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '有向' }).click();
  await expect(edge).not.toHaveAttribute('marker-start');
  await expect(edge).toHaveAttribute('marker-end', 'url(#dw-floating-connection-arrow)');
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '双向' }).click();
  await expect(edge).toHaveAttribute('marker-start', 'url(#dw-floating-connection-arrow-start)');
  await expect(edge).toHaveAttribute('marker-end', 'url(#dw-floating-connection-arrow)');

  await toolbar.getByRole('button', { name: '删除连线' }).click();
  await expect(edge).toHaveCount(0);
  await pointerTool.click();
  await canvas.focus();
  await page.keyboard.press('c');
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + box.width * .26, box.y + box.height * .36);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .46, box.y + box.height * .64, { steps: 8 });
  await page.mouse.up();
  await expect(edge).toHaveCount(1);
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  await expect(pointerTool).toHaveAttribute('aria-pressed', 'true');
});

test('selected connection endpoints detach from nodes independently and keep the line', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=pdf,office');
  const toolbar = page.getByRole('toolbar', { name: '画布工具' });
  const connectionTool = toolbar.getByRole('button', { name: '连线工具' });
  const textTool = toolbar.getByRole('button', { name: '添加文本' });
  await expect(await connectionTool.locator('svg').evaluate((element) => getComputedStyle(element).fill)).toBe(await textTool.locator('svg').evaluate((element) => getComputedStyle(element).fill));

  const sourceNode = page.locator('.react-flow__node[data-id="pdf"]');
  const targetNode = page.locator('.react-flow__node[data-id="office"]');
  const [sourceBox, targetBox] = await Promise.all([sourceNode.boundingBox(), targetNode.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Connection test nodes are not visible');
  await connectionTool.click();
  await page.mouse.move(sourceBox.x + sourceBox.width - 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  const endpoints = page.locator('.dw-floating-connection-endpoint');
  await expect(endpoints).toHaveCount(2);
  const sourceEndpoint = page.locator('.dw-floating-connection-endpoint[data-end="source"]');
  const targetEndpoint = page.locator('.dw-floating-connection-endpoint[data-end="target"]');
  await expect(sourceEndpoint).toHaveAttribute('data-attached', 'true');
  await expect(targetEndpoint).toHaveAttribute('data-attached', 'true');
  await expect(sourceEndpoint).toHaveAttribute('data-item-id', 'pdf');
  await expect(targetEndpoint).toHaveAttribute('data-item-id', 'office');
  const endpointCenter = async (endpoint: typeof sourceEndpoint) => {
    const box = await endpoint.boundingBox();
    if (!box) throw new Error('Connection endpoint is not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const sourceCenter = await endpointCenter(sourceEndpoint);
  const targetCenter = await endpointCenter(targetEndpoint);
  expect(Math.abs(sourceCenter.x - (sourceBox.x + sourceBox.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceCenter.y - (sourceBox.y + sourceBox.height / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(targetCenter.x - targetBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetCenter.y - (targetBox.y + targetBox.height / 2))).toBeLessThanOrEqual(2);

  await toolbar.getByRole('button', { name: '矩形套索' }).click();
  const sourceDragHandle = sourceNode.locator('.dw-resource-node__surface');
  const sourceDragHandleBox = await sourceDragHandle.boundingBox();
  if (!sourceDragHandleBox) throw new Error('Dragged source node handle is not visible');
  await page.mouse.move(sourceDragHandleBox.x + sourceDragHandleBox.width / 2, sourceDragHandleBox.y + sourceDragHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceDragHandleBox.x + sourceDragHandleBox.width / 2 + 96, sourceDragHandleBox.y + sourceDragHandleBox.height / 2 + 48, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await sourceNode.boundingBox())?.x).toBeGreaterThan(sourceBox.x + 80);
  await page.locator('.dw-floating-connection-hit').click({ force: true });
  const movedSourceBox = await sourceNode.boundingBox();
  if (!movedSourceBox) throw new Error('Dragged source node is not visible');
  const movedSourceCenter = await endpointCenter(sourceEndpoint);
  expect(Math.abs(movedSourceCenter.x - sourceCenter.x - (movedSourceBox.x - sourceBox.x))).toBeLessThanOrEqual(2);
  expect(Math.abs(movedSourceCenter.y - sourceCenter.y - (movedSourceBox.y - sourceBox.y))).toBeLessThanOrEqual(2);

  const blankPoints = await page.locator('.react-flow__pane').evaluate((pane) => {
    const rect = pane.getBoundingClientRect();
    const points: { x: number; y: number }[] = [];
    for (let y = rect.top + 48; y < rect.bottom - 48 && points.length < 2; y += 72) {
      for (let x = rect.left + 48; x < rect.right - 48 && points.length < 2; x += 72) {
        const element = document.elementFromPoint(x, y);
        if (!element?.closest('.react-flow__node, .dw-bottom-toolbar')) points.push({ x, y });
      }
    }
    return points;
  });
  if (blankPoints.length < 2) throw new Error('Could not find two blank canvas points');
  const dragEndpointTo = async (endpoint: typeof sourceEndpoint, point: { x: number; y: number }) => {
    const box = await endpoint.boundingBox();
    if (!box) throw new Error('Connection endpoint is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y, { steps: 10 });
    await page.mouse.up();
  };
  await dragEndpointTo(targetEndpoint, blankPoints[0]!);
  await expect(targetEndpoint).toHaveAttribute('data-attached', 'false');
  await expect(sourceEndpoint).toHaveAttribute('data-attached', 'true');
  await dragEndpointTo(sourceEndpoint, blankPoints[1]!);
  await expect(sourceEndpoint).toHaveAttribute('data-attached', 'false');
  await expect(page.locator('.dw-floating-connection')).toHaveCount(1);
});

test('connection anchors use each node’s visible border rather than its outer wrapper', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=markdown,pdf');
  const connectionTool = page.getByRole('toolbar', { name: '画布工具' }).getByRole('button', { name: '连线工具' });
  const markdownSurface = page.locator('.react-flow__node[data-id="markdown"] .dw-product-brief__surface');
  const pdfSurface = page.locator('.react-flow__node[data-id="pdf"] .dw-resource-node__surface');
  const [sourceBox, targetBox] = await Promise.all([markdownSurface.boundingBox(), pdfSurface.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Visible connection borders are not available');
  await connectionTool.click();
  await page.mouse.move(sourceBox.x + sourceBox.width - 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.dw-floating-connection')).toHaveAttribute('marker-end', 'url(#dw-floating-connection-arrow-attached-left)');
  const source = page.locator('.dw-floating-connection-endpoint[data-end="source"]');
  const target = page.locator('.dw-floating-connection-endpoint[data-end="target"]');
  await expect(source).toHaveAttribute('data-item-id', 'markdown');
  await expect(target).toHaveAttribute('data-item-id', 'pdf');
  const centre = async (endpoint: typeof source) => {
    const box = await endpoint.boundingBox();
    if (!box) throw new Error('Connection anchor is not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const [sourceCentre, targetCentre] = await Promise.all([centre(source), centre(target)]);
  expect(Math.abs(sourceCentre.x - (sourceBox.x + sourceBox.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceCentre.y - (sourceBox.y + sourceBox.height / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(targetCentre.x - targetBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetCentre.y - (targetBox.y + targetBox.height / 2))).toBeLessThanOrEqual(2);
});

test('nodes connect from their four blue edge anchors and the selected line can be styled', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const markdown = page.locator('.react-flow__node[data-id="markdown"]');
  const markdownSurface = markdown.locator('.dw-product-brief__surface');
  const markdownTopHandle = markdown.locator('.dw-connection-handle--top');
  const [markdownSurfaceBox, markdownHandleBox] = await Promise.all([markdownSurface.boundingBox(), markdownTopHandle.boundingBox()]);
  if (!markdownSurfaceBox || !markdownHandleBox) throw new Error('Markdown connection border is not visible');
  expect(Math.abs(markdownHandleBox.x + markdownHandleBox.width / 2 - (markdownSurfaceBox.x + markdownSurfaceBox.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(markdownHandleBox.y + markdownHandleBox.height / 2 - markdownSurfaceBox.y)).toBeLessThanOrEqual(2);
  const image = page.locator('.react-flow__node[data-id="image"]');
  const imageSurface = image.locator('.dw-resource-node__surface');
  const imageRightHandle = image.locator('.dw-connection-handle--right');
  const [imageSurfaceBox, imageHandleBox] = await Promise.all([imageSurface.boundingBox(), imageRightHandle.boundingBox()]);
  if (!imageSurfaceBox || !imageHandleBox) throw new Error('Image connection border is not visible');
  expect(Math.abs(imageHandleBox.x + imageHandleBox.width / 2 - (imageSurfaceBox.x + imageSurfaceBox.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(imageHandleBox.y + imageHandleBox.height / 2 - (imageSurfaceBox.y + imageSurfaceBox.height / 2))).toBeLessThanOrEqual(2);

  await page.goto('/test/fixture-ui/?connection-pair=frame,office');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const office = page.locator('.react-flow__node[data-id="office"]');
  const source = frame.locator('.dw-connection-handle--right');
  const target = office.locator('.dw-connection-handle--left');
  await expect(frame.locator('.dw-connection-handle')).toHaveCount(4);
  await expect(source).toHaveCSS('background-color', 'rgb(136, 181, 255)');
  await expect(source).toHaveCSS('border-top-width', '0px');
  await expect(source).toHaveCSS('opacity', '0');
  await source.hover();
  await expect(source).toHaveCSS('opacity', '1');
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Connection handles are not visible');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move((sourceBox.x + targetBox.x) / 2, (sourceBox.y + targetBox.y) / 2, { steps: 6 });
  const connectionPreview = page.locator('path.dw-connection-preview');
  await expect(connectionPreview).toBeVisible();
  await expect(connectionPreview).toHaveAttribute('stroke', '#526074');
  await expect(connectionPreview).toHaveAttribute('stroke-width', '2');
  await expect(connectionPreview).toHaveAttribute('marker-end', 'url(#dw-connection-preview-arrow)');
  await expect(page.locator('marker#dw-connection-preview-arrow path')).toHaveAttribute('d', 'M 0 0 L 12 6 L 0 12 Z');
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  const edge = page.locator('.react-flow__edge');
  await expect(edge).toHaveCount(1);
  const toolbar = page.getByRole('toolbar', { name: '连接线操作' });
  await expect(toolbar).toBeVisible();
  const selectionFilter = edge.locator('filter[id^="dw-connection-selection-"]');
  await expect(edge.locator('.dw-connection-selection-halo')).toHaveCount(0);
  await expect(selectionFilter).toHaveCount(1);
  await expect(selectionFilter).toHaveAttribute('filterUnits', 'userSpaceOnUse');
  await expect(selectionFilter.locator('feMorphology')).toHaveCount(0);
  await expect(selectionFilter.locator('feDropShadow')).toHaveAttribute('stdDeviation', '3');
  await expect(selectionFilter.locator('feDropShadow')).toHaveAttribute('dy', '2');
  await expect(selectionFilter.locator('feDropShadow')).toHaveAttribute('flood-opacity', '.32');
  await expect(edge.locator('marker')).toHaveAttribute('refX', '9.5');
  await expect(edge.locator('marker path')).toHaveAttribute('d', 'M 0 0 L 12 6 L 0 12 Z');
  await expect(edge.locator('.react-flow__edge-path')).toHaveAttribute('style', /stroke: rgb\(82, 96, 116\)/);
  await expect(edge.locator('.react-flow__edge-path')).toHaveAttribute('style', /stroke-width: 3/);
  await expect(edge.locator('.react-flow__edge-path')).toHaveCSS('stroke-linecap', 'butt');
  await expect(edge.locator('.react-flow__edge-path')).toHaveAttribute('style', /filter: url/);

  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '直线' }).click();
  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '虚线' }).click();
  await expect(edge.locator('.react-flow__edge-path')).toHaveCSS('stroke-dasharray', '7px, 5px');
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '双向' }).click();
  await expect(edge.locator('path[marker-start]')).toHaveCount(1);
  await expect(edge.locator('path[marker-end]')).toHaveCount(1);

  const deleteButton = toolbar.getByRole('button', { name: '删除连线' });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.hover();
  await expect(deleteButton.getByRole('tooltip', { name: '删除连线' })).toBeVisible();
  await deleteButton.click();
  await expect(edge).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(edge).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(edge).toHaveCount(0);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(edge).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(edge).toHaveCount(0);
});

test('dragging a connection target reconnects it to a node or removes it on blank canvas', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=frame,office,markdown');
  const source = page.locator('.react-flow__node[data-id="frame"] .dw-connection-handle--right');
  const originalTarget = page.locator('.react-flow__node[data-id="office"] .dw-connection-handle--left');
  const newTarget = page.locator('.react-flow__node[data-id="markdown"] .dw-connection-handle--left');
  const [sourceBox, originalTargetBox, newTargetBox] = await Promise.all([source.boundingBox(), originalTarget.boundingBox(), newTarget.boundingBox()]);
  if (!sourceBox || !originalTargetBox || !newTargetBox) throw new Error('Connection endpoints are not visible');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(originalTargetBox.x + originalTargetBox.width / 2, originalTargetBox.y + originalTargetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  const edge = page.locator('.react-flow__edge');
  await expect(edge).toHaveCount(1);
  const targetEndpoint = edge.locator('.react-flow__edgeupdater-target');
  await expect(targetEndpoint).toBeVisible();
  const targetEndpointBox = await targetEndpoint.boundingBox();
  if (!targetEndpointBox) throw new Error('Connection target endpoint is not visible');

  const blankPoint = { x: originalTargetBox.x + 140, y: originalTargetBox.y + 330 };
  await page.mouse.move(targetEndpointBox.x + targetEndpointBox.width / 2, targetEndpointBox.y + targetEndpointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blankPoint.x, blankPoint.y, { steps: 8 });
  await expect(page.locator('.dw-connection-preview')).toBeVisible();
  await expectPreviewEndpointAt(page, blankPoint);
  await page.mouse.move(newTargetBox.x + newTargetBox.width / 2, newTargetBox.y + newTargetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveAttribute('aria-label', 'Edge from frame to markdown');
  const reconnectedEndpoint = edge.locator('.react-flow__edgeupdater-target');
  const reconnectedEndpointBox = await reconnectedEndpoint.boundingBox();
  if (!reconnectedEndpointBox) throw new Error('Reconnected target endpoint is not visible');

  await page.mouse.move(reconnectedEndpointBox.x + reconnectedEndpointBox.width / 2, reconnectedEndpointBox.y + reconnectedEndpointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blankPoint.x, blankPoint.y, { steps: 12 });
  await expect(page.locator('.dw-connection-preview')).toBeVisible();
  await expectPreviewEndpointAt(page, blankPoint);
  await page.mouse.up();
  await expect(edge).toHaveCount(0);
});

test('a connection cannot target its source node', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=frame,office');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const source = frame.locator('.dw-connection-handle--right');
  const selfTarget = frame.locator('.dw-connection-handle--left');
  const [sourceBox, selfTargetBox] = await Promise.all([source.boundingBox(), selfTarget.boundingBox()]);
  if (!sourceBox || !selfTargetBox) throw new Error('Self-connection handles are not visible');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(selfTargetBox.x + selfTargetBox.width / 2, selfTargetBox.y + selfTargetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('a directed node pair has one connection while the reverse connection remains valid', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=frame,office');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const office = page.locator('.react-flow__node[data-id="office"]');
  const source = frame.locator('.dw-connection-handle--right');
  const target = office.locator('.dw-connection-handle--left');
  const reverseSource = office.locator('.dw-connection-handle--right');
  const reverseTarget = frame.locator('.dw-connection-handle--left');
  const [sourceBox, targetBox, reverseSourceBox, reverseTargetBox] = await Promise.all([source.boundingBox(), target.boundingBox(), reverseSource.boundingBox(), reverseTarget.boundingBox()]);
  if (!sourceBox || !targetBox || !reverseSourceBox || !reverseTargetBox) throw new Error('Connection handles are not visible');

  const drag = async (from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }) => {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await drag(sourceBox, targetBox);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await drag(sourceBox, targetBox);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await drag(reverseSourceBox, reverseTargetBox);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('every connectable node creates a connection from each of its four handles', async ({ page }) => {
  test.setTimeout(120_000);
  for (const sourceId of fixtureNodeIds) {
    const targetId = sourceId === 'markdown' ? 'image' : 'markdown';
    for (const sourceSide of connectionSides) {
      await page.goto(`/test/fixture-ui/?connection-pair=${sourceId},${targetId}`);
      const source = page.locator(`.react-flow__node[data-id="${sourceId}"] .dw-connection-handle--${sourceSide}`);
      const target = page.locator(`.react-flow__node[data-id="${targetId}"] .dw-connection-handle--${oppositeSide[sourceSide]}`);
      const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
      if (!sourceBox || !targetBox) throw new Error(`Connection handle missing for ${sourceId}:${sourceSide}`);

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
      await page.mouse.up();

      await expect(page.locator('.react-flow__edge'), `${sourceId}:${sourceSide}`).toHaveCount(1);
    }
  }
});

test('the connection toolbar applies every shape, stroke, and direction mode', async ({ page }) => {
  await page.goto('/test/fixture-ui/?connection-pair=frame,office');
  const source = page.locator('.react-flow__node[data-id="frame"] .dw-connection-handle--right');
  const target = page.locator('.react-flow__node[data-id="office"] .dw-connection-handle--left');
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Connection handles are not visible');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  const edge = page.locator('.react-flow__edge');
  const path = edge.locator('.react-flow__edge-path');
  const toolbar = page.getByRole('toolbar', { name: '连接线操作' });
  await expect(edge).toHaveCount(1);

  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '直线' }).click();
  await expect(path).toHaveAttribute('d', /^M[^C]*L/);
  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '曲线' }).click();
  await expect(path).toHaveAttribute('d', /C/);
  await toolbar.getByRole('button', { name: '线型' }).click();
  await page.getByRole('menuitemradio', { name: '折线' }).click();
  const elbowPath = await path.getAttribute('d');
  expect(elbowPath).toMatch(/L/);
  expect(elbowPath).not.toMatch(/C/);

  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '实线' }).click();
  await expect(path).toHaveCSS('stroke-dasharray', 'none');
  await toolbar.getByRole('button', { name: '线条样式' }).click();
  await page.getByRole('menuitemradio', { name: '虚线' }).click();
  await expect(path).toHaveCSS('stroke-dasharray', '7px, 5px');

  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '无方向' }).click();
  await expect(edge.locator('path[marker-start], path[marker-end]')).toHaveCount(0);
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '单向' }).click();
  await expect(edge.locator('path[marker-start]')).toHaveCount(0);
  await expect(edge.locator('path[marker-end]')).toHaveCount(1);
  await toolbar.getByRole('button', { name: '连接方向' }).click();
  await page.getByRole('menuitemradio', { name: '双向' }).click();
  await expect(edge.locator('path[marker-start]')).toHaveCount(1);
  await expect(edge.locator('path[marker-end]')).toHaveCount(1);
});

test('every directed pair of distinct node kinds can create a connection', async ({ page }) => {
  test.setTimeout(180_000);
  for (const sourceId of fixtureNodeIds) {
    for (const targetId of fixtureNodeIds) {
      if (sourceId === targetId) continue;
      await page.goto(`/test/fixture-ui/?connection-pair=${sourceId},${targetId}`);
      const source = page.locator(`.react-flow__node[data-id="${sourceId}"] .dw-connection-handle--right`);
      const target = page.locator(`.react-flow__node[data-id="${targetId}"] .dw-connection-handle--left`);
      const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
      if (!sourceBox || !targetBox) throw new Error(`Connection anchor missing for ${sourceId} → ${targetId}`);

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
      await page.mouse.up();

      await expect(page.locator('.react-flow__edge'), `${sourceId} → ${targetId}`).toHaveCount(1);
    }
  }
});

test('video node drags from its chrome without turning playback controls into drag handles', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const video = page.locator('.react-flow__node[data-id="video"]');
  const header = video.locator('.dw-video-node__title');
  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('font-size', '14px');
  await expect(video.locator('.dw-node')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(video.locator('.dw-video-node__surface')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(video.locator('.dw-video-node__surface')).toHaveCSS('padding', '16px');
  const before = await video.boundingBox();
  const surface = video.locator('.dw-video-node__surface');
  const surfaceBox = await surface.boundingBox();
  if (!before || !surfaceBox) throw new Error('Video node is not visible');
  expect(Math.abs(before.height - surfaceBox.height)).toBeLessThanOrEqual(1);

  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error('Video node drag handle is not visible');
  await page.mouse.move(headerBox.x + 24, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + 88, headerBox.y + headerBox.height / 2 + 28, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await video.boundingBox())?.x).toBeGreaterThan(before.x + 48);
  await expect(video.locator('.dw-video-poster')).toHaveClass(/nodrag/);
  await expect(video.getByRole('slider', { name: '视频进度' })).toHaveClass(/nodrag/);
});

test('video controls unlock only after selecting and clicking its interaction overlay again', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const video = page.locator('.react-flow__node[data-id="video"]');
  const overlay = video.locator('.dw-video-node__interaction-overlay');
  await video.evaluate((element) => { element.style.zIndex = '999'; });
  await expect(overlay).toBeVisible();

  await overlay.click();
  await expect(video).toHaveClass(/selected/);
  await expect(overlay).toBeVisible();

  await overlay.click();
  await expect(overlay).toHaveCount(0);

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await expect(overlay).toBeVisible();
});

test('keeps browser pinch zoom globally constrained outside the canvas surface', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const header = page.locator('.canvas-app__header');
  const toolbar = page.getByRole('toolbar', { name: '画布工具' });
  const node = page.locator('.react-flow__node[data-id="markdown"]');
  const viewport = page.locator('.react-flow__viewport');
  await expect(header).toBeVisible();
  await expect(toolbar).toBeVisible();
  await expect(node).toBeVisible();
  const result = await header.evaluate(async (element) => {
    const readZoom = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a;
    const before = readZoom();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true });
    const dispatched = element.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    return { before, after: readZoom(), defaultPrevented: event.defaultPrevented, dispatched };
  });
  expect(result).toMatchObject({ defaultPrevented: true, dispatched: false });
  expect(result.after).toBeCloseTo(result.before, 6);

  const toolbarResult = await toolbar.evaluate(async (element) => {
    const readZoom = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a;
    const before = readZoom();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true });
    const dispatched = element.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    return { before, after: readZoom(), defaultPrevented: event.defaultPrevented, dispatched };
  });
  expect(toolbarResult).toMatchObject({ defaultPrevented: true, dispatched: false });
  expect(toolbarResult.after).toBeCloseTo(toolbarResult.before, 6);

  const nodeResult = await node.evaluate(async (element) => {
    const readZoom = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a;
    const before = readZoom();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true });
    const dispatched = element.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    return { before, after: readZoom(), defaultPrevented: event.defaultPrevented, dispatched };
  });
  expect(nodeResult).toMatchObject({ defaultPrevented: true, dispatched: false });
  expect(nodeResult.after).toBeCloseTo(nodeResult.before, 6);
  await expect(viewport).toBeVisible();
});

test('fixture canvas visual regression stays within two percent', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await expect(page.locator('.canvas-app__canvas')).toBeVisible();
  // System font availability varies by CI image. Pin a browser-bundled family
  // before capturing so the screenshot measures UI changes rather than fonts.
  await page.addStyleTag({ content: '* { font-family: Arial, sans-serif !important; }' });
  await expect(page.locator('.canvas-app__canvas')).toHaveScreenshot('fixture-canvas.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  });
});

test('fixture has one bottom toolbar and no blank-pane context menu', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  await expect(page.getByRole('toolbar', { name: '画布工具' })).toBeVisible();
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 1100, y: 700 } });
  await expect(page.getByRole('menu', { name: '画布菜单' })).not.toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await expect(page.locator('.dw-product-brief')).toHaveCount(1);
});

test('canvas toolbar is a left-centred vertical action rail', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const toolbar = page.getByRole('toolbar', { name: '画布工具' });
  const canvas = page.locator('.canvas-app__canvas');
  const [toolbarBox, canvasBox] = await Promise.all([toolbar.boundingBox(), canvas.boundingBox()]);
  if (!toolbarBox || !canvasBox) throw new Error('Canvas toolbar is not visible');

  expect(toolbarBox.x).toBeLessThanOrEqual(canvasBox.x + 20);
  expect(Math.abs(toolbarBox.y + toolbarBox.height / 2 - (canvasBox.y + canvasBox.height / 2))).toBeLessThanOrEqual(1);
  expect(toolbarBox.height).toBeGreaterThan(toolbarBox.width);

  const lassoMenuToggle = toolbar.getByRole('button', { name: '选择套索工具' });
  await expect(lassoMenuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(lassoMenuToggle.locator('path')).toHaveAttribute('d', 'm9 5 7 7-7 7');
  await expect(lassoMenuToggle.locator('svg')).toHaveClass(/is-collapsed/);
  await lassoMenuToggle.click();
  await expect(lassoMenuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(lassoMenuToggle.locator('svg')).toHaveClass(/is-expanded/);
  const menuBox = await page.getByRole('menu').boundingBox();
  if (!menuBox) throw new Error('Lasso menu is not visible');
  expect(menuBox.x).toBeGreaterThan(toolbarBox.x + toolbarBox.width);
});

test('bottom toolbar returns to pointer when Escape clears canvas state', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const toolbar = page.getByRole('toolbar', { name: '画布工具' });
  const handTool = toolbar.getByRole('button', { name: '手形工具' });
  const pointerTool = toolbar.getByRole('button', { name: '矩形套索' });
  await expect(pointerTool).toHaveClass(/is-active/);
  await handTool.click();
  await expect(handTool).toHaveClass(/is-active/);
  await page.keyboard.press('Escape');
  await expect(pointerTool).toHaveClass(/is-active/);
});

test('canvas shortcuts activate text, frame, and web preview placement tools', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const canvas = page.locator('[data-dream-weave-canvas-renderer]');

  await expect(canvas).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await canvas.focus();
  await expect(canvas).toBeFocused();
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const pointer = { x: paneBox.x + 80, y: paneBox.y + 80 };

  await page.keyboard.press('t');
  await page.mouse.move(pointer.x, pointer.y);
  await expect(page.locator('.dw-placement-draft--moving')).toBeVisible();
  await expect(page.locator('.dw-placement-draft--web')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await expect(canvas).toHaveAttribute('data-frame-drawing', 'true');

  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await page.mouse.move(pointer.x, pointer.y);
  await expect(page.locator('.dw-placement-draft--web.dw-placement-draft--moving')).toBeVisible();
});

test('Cmd/Ctrl+Arrow creates a selected text node beside a selected non-Frame node without entering edit mode', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const initialIds = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  const initialEdgeCount = await page.locator('.react-flow__edge').count();
  const markdown = page.locator('.react-flow__node[data-id="markdown"]');
  await markdown.evaluate((element) => { element.style.zIndex = '999'; });
  await markdown.locator('.dw-product-brief__interaction-overlay').click();
  await expect(markdown).toHaveClass(/selected/);

  await page.keyboard.press('Meta+ArrowRight');
  await expect.poll(async () => page.locator('.react-flow__node').evaluateAll((nodes, knownIds) => (
    nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !knownIds.includes(id)) ?? null
  ), initialIds)).not.toBeNull();
  const createdId = await page.locator('.react-flow__node').evaluateAll((nodes, knownIds) => (
    nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !knownIds.includes(id)) ?? null
  ), initialIds);
  if (!createdId) throw new Error('Cmd+Arrow did not create a text node');
  const created = page.locator(`.react-flow__node[data-id="${createdId}"]`);
  const sourcePosition = await markdown.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0'), width: Number.parseFloat((element as HTMLElement).style.width), height: Number.parseFloat((element as HTMLElement).style.height) }));
  const createdPosition = await created.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }));
  expect(createdPosition.x).toBe(sourcePosition.x + sourcePosition.width + 32);
  expect(createdPosition.y).toBe(sourcePosition.y + (sourcePosition.height - 100) / 2);
  await expect(created).toHaveClass(/selected/);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdgeCount + 1);
  const editor = created.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(editor).not.toBeFocused();

  await markdown.locator('.dw-product-brief__interaction-overlay').click();
  await page.keyboard.press('Meta+ArrowRight');
  await expect.poll(async () => page.locator('.react-flow__node').count()).toBe(initialIds.length + 2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdgeCount + 2);
  const secondSibling = await page.locator('.react-flow__node').evaluateAll((nodes, knownIds) => nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !knownIds.includes(id)) ?? null, [...initialIds, createdId]);
  if (!secondSibling) throw new Error('Second directional shortcut did not create a sibling text node');
  const allSiblingPositions = await page.locator('.react-flow__node').evaluateAll((nodes, ids) => nodes
    .filter((node) => ids.includes(node.getAttribute('data-id')))
    .map((node) => ({ id: node.getAttribute('data-id'), x: Number.parseFloat((node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[1] ?? '0'), y: Number.parseFloat((node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2] ?? '0') }))
    .sort((left, right) => left.y - right.y), [createdId, secondSibling]);
  expect(allSiblingPositions.map(({ x }) => x)).toEqual([sourcePosition.x + sourcePosition.width + 32, sourcePosition.x + sourcePosition.width + 32]);
  expect(allSiblingPositions.map(({ y }) => y)).toEqual([sourcePosition.y - 100, sourcePosition.y + 100]);

  const image = page.locator('.react-flow__node[data-id="image"]');
  await image.locator('.dw-resource-node__title').evaluate((element: HTMLElement) => element.click());
  await expect(image).toHaveClass(/selected/);
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(async () => page.locator('.react-flow__node').count()).toBe(initialIds.length + 3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdgeCount + 3);

  const frame = page.locator('.react-flow__node[data-id="frame"]');
  await frame.locator('.dw-frame-node').click();
  await expect(frame).toHaveClass(/selected/);
  await page.keyboard.press('Meta+ArrowUp');
  await expect(page.locator('.react-flow__node')).toHaveCount(initialIds.length + 3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdgeCount + 3);
});

test('Enter immediately after Cmd/Ctrl+Arrow edits the new text node', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const initialIds = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  const source = page.locator('.react-flow__node[data-id="markdown"]');
  await source.evaluate((element) => { element.style.zIndex = '999'; });
  await source.locator('.dw-product-brief__interaction-overlay').click();

  await page.keyboard.press('Meta+ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(async () => page.locator('.react-flow__node').evaluateAll((nodes, knownIds) => (
    nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !knownIds.includes(id)) ?? null
  ), initialIds)).not.toBeNull();
  const createdId = await page.locator('.react-flow__node').evaluateAll((nodes, knownIds) => (
    nodes.map((node) => node.getAttribute('data-id')).find((id) => id !== null && !knownIds.includes(id)) ?? null
  ), initialIds);
  if (!createdId) throw new Error('Cmd+Arrow did not create a text node');
  const created = page.locator(`.react-flow__node[data-id="${createdId}"]`);
  await expect(created).toHaveClass(/selected/);
  const createdSurface = created.locator('.dw-product-brief__surface');
  const createdEditor = page.locator('[data-canvas-side-drawer]').locator('.dw-markdown-drawer-editor .ProseMirror');
  const sourceEditor = source.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');

  await expect(createdEditor).toHaveAttribute('contenteditable', 'true');
  await expect(createdEditor).toBeFocused();
  await expect(created).toHaveClass(/selected/);
  await expect(createdSurface).toHaveCSS('outline-color', 'rgb(136, 181, 255)');
  await expect.poll(() => createdSurface.evaluate((surface) => getComputedStyle(surface, '::after').outlineColor)).toBe('rgb(136, 181, 255)');
  await expect(source).not.toHaveClass(/selected/);
  await expect(sourceEditor).toHaveAttribute('contenteditable', 'false');
});

test('Frame tool draws a Frame from the blank canvas', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '画框工具' }).click();
  await page.locator('.react-flow__node').evaluateAll((elements) => {
    elements.forEach((element) => { (element as HTMLElement).style.pointerEvents = 'none'; });
  });
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  if (!box) throw new Error('Canvas pane is not visible');

  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 320, { steps: 8 });

  const frameDraft = page.locator('.dw-frame-draw-draft');
  await expect(frameDraft).toBeVisible();
  await expect(frameDraft).toHaveCSS('border-top-style', 'solid');
  await expect(frameDraft).toHaveCSS('border-top-width', '1px');
  await expect(frameDraft).toHaveCSS('border-radius', '12px');
  await expect(frameDraft).toHaveCSS('border-top-color', 'rgba(82, 96, 116, 0.34)');
  await expect(frameDraft.locator('span')).toHaveText('# 未命名组');
  await expect(frameDraft.locator('span')).toHaveCSS('color', 'rgb(145, 152, 165)');
  const [draftBox, draftLabelBox] = await Promise.all([frameDraft.boundingBox(), frameDraft.locator('span').boundingBox()]);
  if (!draftBox || !draftLabelBox) throw new Error('Frame draft label is not visible');

  await page.mouse.move(box.x + 520, box.y + 410, { steps: 6 });
  await expect.poll(async () => (await frameDraft.boundingBox())?.width).toBeGreaterThan(draftBox.width + 100);
  await expect.poll(async () => (await frameDraft.boundingBox())?.height).toBeGreaterThan(draftBox.height + 70);
  const expandedDraftBox = await frameDraft.boundingBox();
  if (!expandedDraftBox) throw new Error('Expanded Frame draft is not visible');
  await page.mouse.up();

  const frame = page.locator('.react-flow__node').filter({ has: page.locator('.dw-frame-node') }).last();
  await expect(frame).toBeVisible();
  const placedLabel = page.locator('.dw-frame-node__label').filter({ hasText: '未命名组' });
  await expect(placedLabel).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(10);
  const [frameBox, placedLabelBox] = await Promise.all([frame.locator('.dw-frame-node').boundingBox(), placedLabel.boundingBox()]);
  if (!frameBox || !placedLabelBox) throw new Error('Placed Frame label is not visible');
  expect(Math.abs((draftLabelBox.x - draftBox.x) - (placedLabelBox.x - frameBox.x))).toBeLessThanOrEqual(0.25);
  expect(frameBox.width).toBeCloseTo(expandedDraftBox.width, 0);
  expect(frameBox.height).toBeCloseTo(expandedDraftBox.height, 0);
});

test('placing the first Frame on an empty canvas preserves the viewport zoom', async ({ page }) => {
  await page.goto('/test/fixture-ui/?empty=1');
  const viewport = page.locator('.react-flow__viewport');
  const readZoom = () => viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  const initialZoom = await readZoom();
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  if (!box) throw new Error('Canvas pane is not visible');

  await page.getByRole('button', { name: '画框工具' }).click();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 28, start.y + 28, { steps: 3 });
  await page.mouse.up();

  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await readZoom()).toBeCloseTo(initialZoom, 6);
  await expect(page.getByLabel('缩放级别')).toHaveValue('100%');
});

test('dragging a Frame moves the nodes fully enclosed by it', async ({ page }) => {
  await page.goto('/test/fixture-ui/?frame-child=1');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const child = page.locator('.react-flow__node[data-id="frame-child"]');
  await expect(frame).toBeVisible();
  await expect(child).toBeVisible();
  const [frameBefore, childBefore] = await Promise.all([frame.boundingBox(), child.boundingBox()]);
  if (!frameBefore || !childBefore) throw new Error('Frame group is not visible');

  // Start in the Frame's empty lower-right area. Content above the Frame must
  // receive the pointer first so it can be dragged out independently.
  await page.mouse.move(frameBefore.x + frameBefore.width - 28, frameBefore.y + frameBefore.height - 28);
  await page.mouse.down();
  await page.mouse.move(frameBefore.x + frameBefore.width + 52, frameBefore.y + frameBefore.height + 22, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await frame.boundingBox())?.x).toBeGreaterThan(frameBefore.x + 60);
  const [frameAfter, childAfter] = await Promise.all([frame.boundingBox(), child.boundingBox()]);
  if (!frameAfter || !childAfter) throw new Error('Frame group disappeared');
  await expect(child).toBeVisible();
  expect(Math.abs((childAfter.x - childBefore.x) - (frameAfter.x - frameBefore.x))).toBeLessThan(4);
  expect(Math.abs((childAfter.y - childBefore.y) - (frameAfter.y - frameBefore.y))).toBeLessThan(4);
});

test('an enclosed image remains draggable and can leave a selected Frame', async ({ page }) => {
  await page.goto('/test/fixture-ui/?frame-child=1');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const child = page.locator('.react-flow__node[data-id="frame-child"]');
  const frameBefore = await frame.boundingBox();
  if (!frameBefore) throw new Error('Frame group is not visible');

  await frame.click({ position: { x: frameBefore.width - 28, y: frameBefore.height - 28 } });
  await expect(frame).toHaveClass(/selected/);
  await expect(frame.locator('.dw-frame-node')).toHaveCSS('outline-color', 'rgb(136, 181, 255)');
  await expect(child).toBeVisible();

  const surface = child.locator('.dw-resource-node__surface');
  const surfaceBefore = await surface.boundingBox();
  if (!surfaceBefore) throw new Error('Frame child image surface is not visible');
  await page.mouse.move(surfaceBefore.x + surfaceBefore.width / 2, surfaceBefore.y + surfaceBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(surfaceBefore.x - 180, surfaceBefore.y - 130, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await surface.boundingBox())?.x).toBeLessThan(surfaceBefore.x - 120);
  await expect(child).toBeVisible();
  const frameAfter = await frame.boundingBox();
  expect(frameAfter?.x).toBeCloseTo(frameBefore.x, 1);
  expect(frameAfter?.y).toBeCloseTo(frameBefore.y, 1);
});

test('dragging a Frame title moves the Frame', async ({ page }) => {
  await page.goto('/test/fixture-ui/?frame-child=1');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const child = page.locator('.react-flow__node[data-id="frame-child"]');
  const title = page.locator('.react-flow__node-toolbar[data-id="frame"]').getByRole('button', { name: '重命名画框' });
  const [frameBefore, childBefore, titleBefore] = await Promise.all([frame.boundingBox(), child.boundingBox(), title.boundingBox()]);
  if (!frameBefore || !childBefore || !titleBefore) throw new Error('Frame title or child is not visible');

  await page.mouse.move(titleBefore.x + titleBefore.width / 2, titleBefore.y + titleBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBefore.x + titleBefore.width / 2 + 90, titleBefore.y + titleBefore.height / 2 + 60, { steps: 8 });
  await expect.poll(async () => (await title.boundingBox())?.x).toBeGreaterThan(titleBefore.x + 70);
  await page.mouse.up();

  await expect.poll(async () => (await frame.boundingBox())?.x).toBeGreaterThan(frameBefore.x + 70);
  const [frameAfter, childAfter, titleAfter] = await Promise.all([frame.boundingBox(), child.boundingBox(), title.boundingBox()]);
  if (!frameAfter || !childAfter || !titleAfter) throw new Error('Frame group disappeared');
  expect(Math.abs((childAfter.x - childBefore.x) - (frameAfter.x - frameBefore.x))).toBeLessThan(4);
  expect(Math.abs((childAfter.y - childBefore.y) - (frameAfter.y - frameBefore.y))).toBeLessThan(4);
  expect(Math.abs((titleAfter.x - titleBefore.x) - (frameAfter.x - frameBefore.x))).toBeLessThan(4);
  expect(Math.abs((titleAfter.y - titleBefore.y) - (frameAfter.y - frameBefore.y))).toBeLessThan(4);
});

test('dragging directly on an image preview moves its canvas node', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const image = page.locator('.react-flow__node[data-id="image"]');
  const preview = image.locator('img');
  await expect(preview).toBeVisible();
  const before = await image.boundingBox();
  const previewBox = await preview.boundingBox();
  if (!before || !previewBox) throw new Error('Image node is not visible');

  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(previewBox.x + previewBox.width / 2 + 120, previewBox.y + previewBox.height / 2 + 80, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await image.boundingBox())?.x).toBeGreaterThan(before.x + 90);
});

test('Frame title is edited inline and kept after the title loses focus', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const frame = page.locator('.react-flow__node[data-id="frame"]');
  const title = page.locator('.react-flow__node-toolbar[data-id="frame"]').getByRole('button', { name: '重命名画框' });
  await expect(title).toHaveText('第一幕');
  await title.dblclick();
  const input = page.locator('.react-flow__node-toolbar[data-id="frame"]').getByRole('textbox', { name: '重命名画框' });
  await expect(input).toBeFocused();
  await input.fill('UI-home');
  await page.locator('.react-flow__pane').click({ position: { x: 1200, y: 760 } });
  await expect(title).toHaveText('UI-home');
});

test('resource artifact captions stay small and HTML keeps an opaque card', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const imageCaption = page.locator('.dw-node[data-node-kind="image"] .dw-resource-node__title');
  const htmlSurface = page.locator('.dw-node[data-node-kind="html"] .dw-resource-node__surface');
  await expect(imageCaption).toHaveCSS('font-size', '14px');
  await expect(htmlSurface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('PDF uses the clean shared ONLYOFFICE resource-card frame and title chrome', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const pdfNode = page.locator('.react-flow__node[data-id="pdf"]');
  const pdfTitle = pdfNode.locator('.dw-resource-node--pdf .dw-resource-node__title');
  const viewer = pdfNode.locator('.dw-onlyoffice-frame');

  await expect(pdfNode).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(pdfTitle.locator('.dw-canvas-node-title__icon')).toBeVisible();
  await expect(pdfTitle.locator('.dw-canvas-node-title__label')).toHaveText('研究报告');
  await expect(viewer).toHaveAttribute('src', 'https://office.test/dw-viewer-shell/fixture-pdf-session');
  await expect(viewer).toHaveCSS('pointer-events', 'none');
  await expect(pdfNode.locator('.react-pdf__Document, canvas, object')).toHaveCount(0);
});

test('fixture production upload preserves mixed file selection order', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const longText = '劳动合同条款 '.repeat(2_000);
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('first') },
    { name: 'second.md', mimeType: 'text/markdown', buffer: Buffer.from('# second') },
    { name: 'third.pdf', mimeType: 'application/pdf', buffer: Buffer.from('third') },
    { name: 'contract.txt', mimeType: 'text/plain', buffer: Buffer.from(longText) },
  ]);

  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(13);
  const uploadedTitles = await nodes.evaluateAll((elements) => elements.slice(-4).map((element) => element.textContent));
  expect(uploadedTitles[0]).toContain('first.png');
  await expect(nodes.nth(10).frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror')).toContainText('second');
  expect(uploadedTitles[2]).toContain('third.pdf');
  await expect.poll(() => nodes.nth(12).evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBe(924.333);
});

test('trackpad-style scrolling pans the canvas without changing zoom', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const pane = page.locator('.react-flow__pane');
  const viewport = page.locator('.react-flow__viewport');
  const readViewport = () => viewport.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
  const before = await readViewport();

  await pane.hover({ position: { x: 40, y: 40 } });
  await page.mouse.wheel(0, 220);
  await expect.poll(async () => Math.hypot((await readViewport()).x - before.x, (await readViewport()).y - before.y)).toBeGreaterThan(0);
  expect((await readViewport()).zoom).toBeCloseTo(before.zoom, 6);
});

test('macOS trackpad pinch zooms the canvas instead of panning it', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const pane = page.locator('.react-flow__pane');
  const result = await pane.evaluate(async (element) => {
    const viewport = document.querySelector('.react-flow__viewport');
    if (!viewport) throw new Error('Canvas viewport is not available');
    const readViewport = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    };
    const before = readViewport();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: 500,
      clientY: 400,
    });
    const dispatched = element.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return { before, after: readViewport(), defaultPrevented: event.defaultPrevented, dispatched };
  });

  expect(result.defaultPrevented).toBe(true);
  expect(result.dispatched).toBe(false);
  expect(result.after.zoom).toBeGreaterThan(result.before.zoom);
});

test('hand tool pans with drag and scrolling, and zooms with trackpad pinch', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const toolbar = page.getByRole('toolbar', { name: '画布工具' });
  const handTool = toolbar.getByRole('button', { name: '手形工具' });
  const pointerTool = toolbar.getByRole('button', { name: '矩形套索' });
  await handTool.click();
  await expect(handTool).toHaveClass(/is-active/);
  await expect(pointerTool).not.toHaveClass(/is-active/);

  const pane = page.locator('.react-flow__pane');
  const viewport = page.locator('.react-flow__viewport');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const readViewport = () => viewport.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });

  const beforeDrag = await readViewport();
  await page.mouse.move(paneBox.x + 80, paneBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + 180, paneBox.y + 130, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.hypot((await readViewport()).x - beforeDrag.x, (await readViewport()).y - beforeDrag.y)).toBeGreaterThan(0);
  expect((await readViewport()).zoom).toBeCloseTo(beforeDrag.zoom, 6);

  const beforeScroll = await readViewport();
  await pane.hover({ position: { x: 80, y: 80 } });
  await page.mouse.wheel(0, 220);
  await expect.poll(async () => Math.hypot((await readViewport()).x - beforeScroll.x, (await readViewport()).y - beforeScroll.y)).toBeGreaterThan(0);
  expect((await readViewport()).zoom).toBeCloseTo(beforeScroll.zoom, 6);

  const result = await pane.evaluate(async (element, pointer) => {
    const viewport = document.querySelector('.react-flow__viewport');
    if (!viewport) throw new Error('Canvas viewport is not available');
    const readViewport = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    };
    const before = readViewport();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    const dispatched = element.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return { before, after: readViewport(), defaultPrevented: event.defaultPrevented, dispatched };
  }, { x: paneBox.x + 80, y: paneBox.y + 80 });

  expect(result.defaultPrevented).toBe(true);
  expect(result.dispatched).toBe(false);
  expect(result.after.zoom).toBeGreaterThan(result.before.zoom);
});

test('text placement ghost is centred on the cursor and lands centred at the clicked position', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '添加文本' }).click();
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const nodeBoxes = await page.locator('.react-flow__node').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }));
  const target = [
    { x: 80, y: 80 }, { x: paneBox.width - 80, y: 80 },
    { x: 80, y: paneBox.height - 160 }, { x: paneBox.width - 220, y: paneBox.height - 160 },
  ].find(({ x, y }) => !nodeBoxes.some((box) => x + paneBox.x >= box.left - 12 && x + paneBox.x <= box.right + 12 && y + paneBox.y >= box.top - 12 && y + paneBox.y <= box.bottom + 12));
  if (!target) throw new Error('Fixture has no empty canvas position for text placement');
  await page.mouse.move(paneBox.x + target.x, paneBox.y + target.y);

  const ghost = page.locator('.dw-placement-draft--moving');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveCSS('width', '550px');
  await expect(ghost).toHaveCSS('height', '100px');
  await expect(ghost.locator('.dw-placement-draft__markdown-ghost')).toBeVisible();
  await expect(ghost.locator('.dw-canvas-node-title__icon')).toBeVisible();
  await expect(ghost.locator('.dw-canvas-node-title__label')).toHaveText('文本');
  const ghostPlaceholder = ghost.locator('.dw-placement-draft__markdown-placeholder');
  await expect(ghostPlaceholder).toHaveText('输入 Markdown，使用 / 插入块');
  await expect(ghostPlaceholder).toBeVisible();
  await expect(ghostPlaceholder).toHaveCSS('left', '64px');
  await expect(ghostPlaceholder).toHaveCSS('top', '16px');
  const ghostLayout = await ghost.locator('.dw-placement-draft__markdown-ghost').evaluate((root) => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const relativeBox = (selector: string) => {
      const box = root.querySelector(selector)?.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      return box && { x: round(box.x - rootBox.x), y: round(box.y - rootBox.y), width: round(box.width), height: round(box.height) };
    };
    return { title: relativeBox('.dw-product-brief__header'), icon: relativeBox('.dw-canvas-node-title__icon'), placeholder: relativeBox('.dw-placement-draft__markdown-placeholder') };
  });
  const ghostBox = await ghost.boundingBox();
  if (!ghostBox) throw new Error('Text placement ghost is not visible');
  expect(Math.abs(ghostBox.x + ghostBox.width / 2 - (paneBox.x + target.x))).toBeLessThan(4);
  expect(Math.abs(ghostBox.y + ghostBox.height / 2 - (paneBox.y + target.y))).toBeLessThan(4);

  await page.mouse.click(paneBox.x + target.x, paneBox.y + target.y);
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.dw-product-brief') }).last();
  await expect(node).toBeVisible();
  const placeholder = node.locator('.dw-product-brief__empty-placeholder');
  await expect(placeholder).toHaveText('输入 Markdown，使用 / 插入块');
  await expect(placeholder).toBeVisible();
  const nodeLayout = await node.locator('.dw-product-brief').evaluate((root) => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const relativeBox = (selector: string) => {
      const box = root.querySelector(selector)?.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      return box && { x: round(box.x - rootBox.x), y: round(box.y - rootBox.y), width: round(box.width), height: round(box.height) };
    };
    return { title: relativeBox('.dw-product-brief__header'), icon: relativeBox('.dw-canvas-node-title__icon'), placeholder: relativeBox('.dw-product-brief__empty-placeholder') };
  });
  expect(nodeLayout).toEqual(ghostLayout);
  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error('Placed text node is not visible');
  expect(Math.abs(nodeBox.x - ghostBox.x)).toBeLessThan(4);
  expect(Math.abs(nodeBox.y - ghostBox.y)).toBeLessThan(4);

  await page.getByRole('button', { name: '矩形套索' }).click();
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await expect(node).toHaveClass(/selected/);
  await expect(placeholder).toBeVisible();
});

test('double-clicking an empty canvas position creates a selected text node and opens its drawer editor', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const nodeBoxes = await page.locator('.react-flow__node').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }));
  const target = [
    { x: 80, y: 80 }, { x: paneBox.width - 80, y: 80 },
    { x: 80, y: paneBox.height - 160 }, { x: paneBox.width - 220, y: paneBox.height - 160 },
  ].find(({ x, y }) => !nodeBoxes.some((box) => x + paneBox.x >= box.left - 12 && x + paneBox.x <= box.right + 12 && y + paneBox.y >= box.top - 12 && y + paneBox.y <= box.bottom + 12));
  if (!target) throw new Error('Fixture has no empty canvas position for text creation');

  await pane.dblclick({ position: target });

  const node = page.locator('.react-flow__node').filter({ has: page.locator('.dw-product-brief') }).last();
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(node).toHaveClass(/selected/);
  await expect(drawer).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
});

test('web preview URL form keeps the ghost card dimensions after placement', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '添加网页预览' }).click();
  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');

  const placementPoint = { x: paneBox.x + 40, y: paneBox.y + 40 };
  await page.mouse.move(placementPoint.x, placementPoint.y);
  await page.mouse.click(placementPoint.x, placementPoint.y);

  const form = page.locator('.dw-placement-draft--web:not(.dw-placement-draft--moving)');
  await expect(form).toBeVisible();
  const formBox = await form.boundingBox();
  if (!formBox) throw new Error('Web preview URL form is not visible');
  expect(formBox.width).toBe(520);
  expect(formBox.height).toBe(360);
  expect(Math.abs(formBox.x + formBox.width / 2 - placementPoint.x)).toBeLessThan(2);
  expect(Math.abs(formBox.y + formBox.height / 2 - placementPoint.y)).toBeLessThan(2);

  await form.getByRole('textbox').fill('https://example.com');
  await form.getByRole('button', { name: '立即预览' }).click();
  const createdNode = page.locator('.dw-node[data-node-kind="web-preview"]').last();
  await expect(createdNode).toHaveCSS('width', '520px');
  await expect(createdNode).toHaveCSS('height', '360px');
});

test('web preview placement ghost uses the compact preview size', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '添加网页预览' }).click();
  await expect(page.locator('.dw-placement-draft--web.dw-placement-draft--moving')).toHaveCount(0);

  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('Canvas pane is not visible');
  const pointer = { x: paneBox.x + 80, y: paneBox.y + 80 };
  await page.mouse.move(pointer.x, pointer.y);

  const ghost = page.locator('.dw-placement-draft--web.dw-placement-draft--moving');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveCSS('width', '520px');
  await expect(ghost).toHaveCSS('height', '360px');
  await expect(ghost).toHaveCSS('opacity', '0.58');
  const ghostBox = await ghost.boundingBox();
  if (!ghostBox) throw new Error('Web preview placement ghost is not visible');
  expect(Math.abs(ghostBox.x + ghostBox.width / 2 - pointer.x)).toBeLessThan(2);
  expect(Math.abs(ghostBox.y + ghostBox.height / 2 - pointer.y)).toBeLessThan(2);
  const form = ghost.locator('form');
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute('aria-hidden', 'true');
  await expect(form).toHaveCSS('width', '320px');
  await expect(ghost.locator('input')).toHaveCSS('width', '320px');
  await expect(form.evaluate((element) => (element as HTMLFormElement).inert)).resolves.toBe(true);
});

test('web preview uses the resource-card chrome without external navigation', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = page.locator('.dw-node[data-node-kind="web-preview"]');

  const title = node.locator('.dw-resource-node--web-preview .dw-resource-node__title');
  await expect(title).toHaveText('网页参考');
  await expect(node).toHaveCSS('overflow', 'visible');
  await expect(node.locator('.dw-node__header')).toHaveCount(0);
  await expect(node.getByRole('link', { name: '在新标签页打开' })).toHaveCount(0);
  await expect(node.getByRole('status')).toHaveCount(0);

  await node.locator('iframe').evaluate((frame) => { (frame as HTMLElement).style.pointerEvents = 'none'; });
  await node.locator('..').click({ position: { x: 20, y: 20 } });
  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button')).toHaveCount(2);
  const [toolbarBox, nodeBox] = await Promise.all([toolbar.boundingBox(), node.boundingBox()]);
  if (!toolbarBox || !nodeBox) throw new Error('Web preview toolbar or card is not visible');
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(nodeBox.y);
});

test('text and image nodes keep the same HoverToolbar top offset', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  const imageNode = page.locator('.dw-node[data-node-kind="image"]');
  const imageSurface = imageNode.locator('.dw-resource-node__surface');
  await imageNode.locator('img').click();
  await expect(toolbar).toBeVisible();
  const [imageToolbarBox, imageSurfaceBox] = await Promise.all([toolbar.boundingBox(), imageSurface.boundingBox()]);
  if (!imageToolbarBox || !imageSurfaceBox) throw new Error('Image HoverToolbar or surface is not visible');
  const imageGap = (imageSurfaceBox.y - imageToolbarBox.y - imageToolbarBox.height) / (imageSurfaceBox.width / 360);

  const textNode = page.locator('.react-flow__node').filter({ has: page.locator('.dw-product-brief') }).first();
  const textSurface = textNode.locator('.dw-product-brief__surface');
  await textNode.evaluate((element) => { element.style.zIndex = '999'; });
  const textContent = textNode.locator('.dw-product-brief__content');
  const textContentBox = await textContent.boundingBox();
  if (!textContentBox) throw new Error('Text content is not visible');
  await textNode.locator('.dw-product-brief__interaction-overlay').click({ position: { x: textContentBox.width - 18, y: textContentBox.height - 18 } });
  await expect(toolbar).toBeVisible();
  const [textToolbarBox, textSurfaceBox] = await Promise.all([toolbar.boundingBox(), textSurface.boundingBox()]);
  if (!textToolbarBox || !textSurfaceBox) throw new Error('Text HoverToolbar or surface is not visible');
  const textGap = (textSurfaceBox.y - textToolbarBox.y - textToolbarBox.height) / (textSurfaceBox.width / 534);

  expect(Math.abs(textGap - imageGap)).toBeLessThanOrEqual(1);
});

test('node HoverToolbar actions show their labels as tooltips', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = page.locator('.dw-node[data-node-kind="web-preview"]');
  await node.locator('iframe').evaluate((frame) => { (frame as HTMLElement).style.pointerEvents = 'none'; });
  await node.locator('..').click({ position: { x: 20, y: 20 } });

  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  await expect(toolbar).toBeVisible();
  const duplicate = toolbar.getByRole('button', { name: '复制一份' });
  const remove = toolbar.getByRole('button', { name: '删除' });
  await expect(duplicate).toHaveAttribute('data-tooltip', '复制一份');
  await expect(remove).toHaveAttribute('data-tooltip', '删除');

  await duplicate.hover();
  await expect.poll(() => duplicate.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('1');
  await expect.poll(() => duplicate.evaluate((button) => getComputedStyle(button, '::after').content)).toBe('"复制一份"');

  const originalNode = page.locator('.react-flow__node[data-id="web"]');
  await duplicate.click();
  await expect(page.locator('.dw-node[data-node-kind="web-preview"]')).toHaveCount(2);
  const copiedNode = page.locator('.react-flow__node:not([data-id="web"])').filter({ has: page.locator('.dw-node[data-node-kind="web-preview"]') });
  await expect(originalNode).not.toHaveClass(/selected/);
  await expect(copiedNode).toHaveClass(/selected/);
});

test('text node labels itself as text, keeps its preview readonly, and edits in the drawer', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.dw-product-brief') }).first();
  const preview = node.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');
  await node.evaluate((element) => { element.style.zIndex = '999'; });

  await expect(node.locator('.dw-product-brief__header .dw-canvas-node-title__label')).toHaveText('文本');
  await expect(preview).toHaveAttribute('contenteditable', 'false');
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await expect(node).toHaveClass(/selected/);
  await node.locator('.dw-product-brief__interaction-overlay').click();

  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(drawer).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('编辑验证');
  await expect(editor).toContainText('编辑验证');
  await editor.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(preview).toContainText('编辑验证');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path()!, 'utf8')).toContain('编辑验证');
});

test('pressing Enter on a selected text node edits from the document end', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.dw-product-brief') }).first();
  const overlay = node.locator('.dw-product-brief__interaction-overlay');
  const preview = node.frameLocator('iframe.dw-markdown-editor-frame').locator('.ProseMirror');
  await node.evaluate((element) => { element.style.zIndex = '999'; });

  await overlay.click();
  await expect(node).toHaveClass(/selected/);
  await expect(preview).toHaveAttribute('contenteditable', 'false');

  await page.keyboard.press('Enter');
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(drawer).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  const textBefore = await editor.textContent();
  await editor.pressSequentially('末尾追加');
  await expect.poll(() => editor.textContent()).toBe(`${textBefore}末尾追加`);
});

test('the canvas preview iframe stays contained after a drawer editor is closed', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = page.locator('.react-flow__node[data-id="markdown"]');
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await node.locator('.dw-product-brief__interaction-overlay').click();
  await node.locator('.dw-product-brief__interaction-overlay').click();
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(node).toHaveClass(/selected/);
  await expect(node.locator('iframe.dw-markdown-editor-frame')).not.toHaveClass(/has-popup-viewport/);
});

test('editing a text node adds height for new lines and stops at its maximum', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const node = page.locator('.react-flow__node[data-id="markdown"]');
  const content = node.locator('.dw-product-brief__content');
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  const contentBox = await content.boundingBox();
  if (!contentBox) throw new Error('Text content is not visible');
  const contentClick = { x: contentBox.width - 18, y: contentBox.height - 18 };

  await node.locator('.dw-product-brief__interaction-overlay').click({ position: contentClick });
  await node.locator('.dw-product-brief__interaction-overlay').click({ position: contentClick });
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  let previousHeight = await node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height));
  for (let index = 0; index < 4; index += 1) {
    await editor.press('End');
    await editor.press('Enter');
    await editor.pressSequentially(`新增第${index + 1}行`);
    await expect.poll(async () => node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBeGreaterThan(previousHeight);
    previousHeight = await node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height));
  }
  await expect(editor.locator('p').first()).toHaveCSS('line-height', '21px');
  await expect(editor.locator('p').first()).toHaveCSS('margin-bottom', '0px');
  await expect(editor.locator('p').first()).toHaveCSS('padding-bottom', '0px');

  for (let index = 0; index < 50; index += 1) {
    await editor.press('Enter');
    await editor.pressSequentially(`第${index + 1}行`);
    await page.waitForTimeout(20);
  }
  await expect.poll(async () => node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBe(924.333);
  await expect.poll(() => editor.evaluate(() => document.body.scrollHeight > document.body.clientHeight)).toBe(true);
  await editor.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect.poll(async () => node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBe(924.333);
});

test('text node immediately grows for soft-wrapped text before it reaches its maximum height', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  await page.getByRole('button', { name: '矩形套索' }).click();
  const node = page.locator('.react-flow__node[data-id="markdown"]');
  const content = node.locator('.dw-product-brief__content');
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  const contentBox = await content.boundingBox();
  if (!contentBox) throw new Error('Text content is not visible');
  const click = { x: contentBox.width - 18, y: contentBox.height - 18 };

  await node.locator('.dw-product-brief__interaction-overlay').click({ position: click });
  await node.locator('.dw-product-brief__interaction-overlay').click({ position: click });
  const drawer = page.locator('[data-canvas-side-drawer]');
  const editor = drawer.locator('.dw-markdown-drawer-editor .ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  const before = await node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height));
  await editor.press('End');
  await editor.pressSequentially('软换行内容'.repeat(60));
  await expect.poll(() => node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBeGreaterThan(before);
  const after = await node.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height));
  expect(after).toBeLessThan(924.333);
  await expect.poll(() => editor.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
});

test('selected text node has no manual resize controls and retains its fixed width', async ({ page }) => {
  await page.goto('/test/fixture-ui/');
  const node = page.locator('.react-flow__node[data-id="markdown"]');
  await node.evaluate((element) => { element.style.zIndex = '999'; });
  await page.getByRole('button', { name: '矩形套索' }).click();
  await node.locator('.dw-product-brief__interaction-overlay').click();

  await expect(node.locator('.react-flow__resize-control')).toHaveCount(0);
  await expect(node).toHaveCSS('width', '550px');
});
