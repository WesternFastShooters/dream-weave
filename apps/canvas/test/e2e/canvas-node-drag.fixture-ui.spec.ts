import { expect, test, type Page } from '@playwright/test';
import type { CanvasItemKind } from '@dream-weave/canvas-core';

type DragCase = {
  fixtureId: string;
  pairedWith: string;
  handle: string;
};

const dragCases = {
  markdown: { fixtureId: 'markdown', pairedWith: 'image', handle: '.dw-product-brief__interaction-overlay' },
  image: { fixtureId: 'image', pairedWith: 'markdown', handle: '.dw-resource-node__surface' },
  audio: { fixtureId: 'audio', pairedWith: 'markdown', handle: '.dw-audio-node__interaction-overlay' },
  video: { fixtureId: 'video', pairedWith: 'markdown', handle: '.dw-video-node__interaction-overlay' },
  'web-preview': { fixtureId: 'web', pairedWith: 'markdown', handle: '.dw-resource-node__surface' },
  html: { fixtureId: 'html', pairedWith: 'markdown', handle: '.dw-resource-node__surface' },
  pdf: { fixtureId: 'pdf', pairedWith: 'markdown', handle: '.dw-resource-node__surface' },
  office: { fixtureId: 'office', pairedWith: 'markdown', handle: '.dw-resource-node__surface' },
  frame: { fixtureId: 'frame', pairedWith: 'image', handle: '.dw-frame-node' },
} satisfies Record<CanvasItemKind, DragCase>;

async function dragNode(page: Page, nodeId: string, handleSelector: string): Promise<void> {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  const handle = node.locator(handleSelector);
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('data-drag-handle', 'true');

  const [before, handleBox] = await Promise.all([node.boundingBox(), handle.boundingBox()]);
  if (!before || !handleBox) throw new Error(`Drag handle is not visible for ${nodeId}`);

  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 60, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await node.boundingBox())?.x, `${nodeId} should move after dragging`).toBeGreaterThan(before.x + 70);
}

test.describe('canvas node dragging', () => {
  for (const [kind, dragCase] of Object.entries(dragCases) as [CanvasItemKind, DragCase][]) {
    test(`${kind} node can be dragged from its designated canvas handle`, async ({ page }) => {
      await page.goto(`/test/fixture-ui/?connection-pair=${dragCase.fixtureId},${dragCase.pairedWith}`);
      await dragNode(page, dragCase.fixtureId, dragCase.handle);
    });
  }
});
