import { expect, test, type Page } from '@playwright/test';

const nodeCases = [
  { id: 'markdown', kind: 'markdown', targetId: 'image', select: '.dw-product-brief__header' },
  { id: 'image', kind: 'image', targetId: 'markdown', select: '.dw-resource-node__title' },
  { id: 'audio', kind: 'audio', targetId: 'markdown', select: '.dw-audio-node__title' },
  { id: 'video', kind: 'video', targetId: 'markdown', select: '.dw-video-node__title' },
  { id: 'web', kind: 'web-preview', targetId: 'markdown', select: '.dw-resource-node__title' },
  { id: 'html', kind: 'html', targetId: 'markdown', select: '.dw-resource-node__title' },
  { id: 'pdf', kind: 'pdf', targetId: 'markdown', select: '.dw-resource-node__title' },
  { id: 'office', kind: 'office', targetId: 'markdown', select: '.dw-resource-node__title' },
  { id: 'frame', kind: 'frame', targetId: 'markdown', select: '.dw-frame-node' },
] as const;

async function deleteNodeFromToolbar(page: Page, nodeId: string, select: string): Promise<void> {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await expect(node).toBeVisible();
  await node.locator(select).click({ position: { x: 12, y: 12 } });
  await expect(node).toHaveClass(/selected/);

  const toolbar = page.getByRole('toolbar', { name: '节点操作' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: '删除' }).click();
  await expect(node).toHaveCount(0);
}

for (const nodeCase of nodeCases) {
  test(`deletes the ${nodeCase.kind} canvas node from its toolbar`, async ({ page }) => {
    await page.goto(`/test/fixture-ui/?connection-pair=${nodeCase.id},${nodeCase.targetId}`);

    await deleteNodeFromToolbar(page, nodeCase.id, nodeCase.select);
    await expect(page.locator(`.react-flow__node[data-id="${nodeCase.targetId}"]`)).toHaveCount(1);
  });
}
