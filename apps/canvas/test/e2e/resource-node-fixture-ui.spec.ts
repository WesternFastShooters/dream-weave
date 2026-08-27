import { expect, test } from '@playwright/test';

test('image and uploaded HTML use the artifact-card chrome', async ({ page }) => {
  await page.goto('/test/fixture-ui/');

  const imageNode = page.locator('.dw-node[data-node-kind="image"]');
  const imageTitle = imageNode.locator('.dw-resource-node__title');
  const imageSurface = imageNode.locator('.dw-resource-node__surface');
  await expect(imageTitle).toHaveText('参考图片');
  await expect(imageNode.locator('.dw-node__header')).toHaveCount(0);
  await expect(imageNode.locator('footer')).toHaveCount(0);
  await expect(imageSurface.locator('img')).toBeVisible();

  const [imageTitleBox, imageSurfaceBox] = await Promise.all([imageTitle.boundingBox(), imageSurface.boundingBox()]);
  if (!imageTitleBox || !imageSurfaceBox) throw new Error('Image resource-node chrome is not visible');
  expect(imageTitleBox.y + imageTitleBox.height).toBeLessThanOrEqual(imageSurfaceBox.y);

  const htmlNode = page.locator('.dw-node[data-node-kind="html"]');
  const htmlTitle = htmlNode.locator('.dw-resource-node__title');
  const htmlSurface = htmlNode.locator('.dw-resource-node__surface');
  await expect(htmlTitle).toHaveText('互动地图');
  await expect(htmlNode.locator('.dw-node__header')).toHaveCount(0);
  await expect(htmlSurface.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');

  const [htmlTitleBox, htmlSurfaceBox] = await Promise.all([htmlTitle.boundingBox(), htmlSurface.boundingBox()]);
  if (!htmlTitleBox || !htmlSurfaceBox) throw new Error('HTML resource-node chrome is not visible');
  expect(htmlTitleBox.y + htmlTitleBox.height).toBeLessThanOrEqual(htmlSurfaceBox.y);
});

test('Office preview uses the same title-outside resource-card chrome', async ({ page }) => {
  await page.goto('/test/fixture-ui/');

  const officeNode = page.locator('.react-flow__node[data-id="office"]');
  const title = officeNode.locator('.dw-resource-node--office .dw-resource-node__title');
  const surface = officeNode.locator('.dw-resource-node--office .dw-resource-node__surface');
  await expect(title).toHaveText('演示文稿');
  await expect(officeNode.locator('.dw-document-node__title')).toHaveCount(0);
  const preview = surface.locator('.dw-onlyoffice-frame');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('pointer-events', 'none');
  await expect(surface).toHaveCSS('padding', '10px');

  const [titleBox, surfaceBox] = await Promise.all([title.boundingBox(), surface.boundingBox()]);
  if (!titleBox || !surfaceBox) throw new Error('Office resource-node chrome is not visible');
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(surfaceBox.y);

  await officeNode.evaluate((element) => { (element as HTMLElement).style.zIndex = '999'; });
  await surface.click({ position: { x: surfaceBox.width / 2, y: surfaceBox.height / 2 } });
  await expect(officeNode).toHaveClass(/selected/);

  const before = await officeNode.boundingBox();
  if (!before) throw new Error('Office node is not visible');
  await page.mouse.move(surfaceBox.x + surfaceBox.width / 2, surfaceBox.y + surfaceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(surfaceBox.x + surfaceBox.width / 2 + 100, surfaceBox.y + surfaceBox.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await officeNode.boundingBox())?.x).toBeGreaterThan(before.x + 70);
});

test('PDF preview uses the same clean ONLYOFFICE iframe without the react-pdf renderer', async ({ page }) => {
  await page.goto('/test/fixture-ui/');

  const pdfNode = page.locator('.react-flow__node[data-id="pdf"]');
  const title = pdfNode.locator('.dw-resource-node--pdf .dw-resource-node__title');
  const surface = pdfNode.locator('.dw-resource-node--pdf .dw-resource-node__surface');
  const preview = pdfNode.locator('.dw-resource-node--pdf .dw-onlyoffice-frame');
  await expect(title).toHaveText('研究报告');
  await expect(preview).toHaveAttribute('src', 'https://office.test/dw-viewer-shell/fixture-pdf-session');
  await expect(preview).toHaveCSS('pointer-events', 'none');
  await expect(surface).toHaveCSS('padding', '0px');
  await expect(pdfNode.locator('.react-pdf__Document, canvas')).toHaveCount(0);
});
