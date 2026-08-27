import { render } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { CanvasNodeToolbarService } from '../src/creative-node-service.js';
import { WebPreviewNode } from '../src/nodes.js';

const webItem = {
  id: 'web-a', kind: 'web-preview' as const, title: 'preview.test', summary: 'https://preview.test/interactive.html',
  assetId: 'asset-a', url: 'https://preview.test/interactive.html', embeddable: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = { _serviceBrand: undefined, onDidChange: new Signal(), getSnapshot: () => snapshot, setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, dispose: () => undefined };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const services = new ServiceCollection(); services.set(ICanvasInteractionService, interaction); services.set(ICanvasEventService, events);
  return createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: {}, children })));
}

describe('WebPreviewNode interaction contract', () => {
  it('WP-02/WP-03: renders a secure iframe inside a draggable resource surface and title', () => {
    const view = render(createElement(WebPreviewNode, { id: webItem.id, data: { item: webItem }, selected: false, dragging: false } as never), { wrapper });
    const frame = view.container.querySelector<HTMLIFrameElement>('.dw-web-preview-frame')!;
    const title = view.container.querySelector('.dw-resource-node__title');
    const surface = view.container.querySelector('.dw-resource-node__surface');

    expect(frame.src).toBe(webItem.url);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(title?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(surface?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(frame.classList).not.toContain('nodrag');
  });

  it('WP-05A: duplicates a web preview with a new id, a 32px offset, and the next z-index', async () => {
    const document = {
      projectId: 'project',
      items: new Map([[webItem.id, webItem]]),
      placements: new Map([[webItem.id, { itemId: webItem.id, x: 100, y: 200, width: 520, height: 360, zIndex: 4 }]]),
      connections: new Map(), revision: 0,
    };
    const history = { execute: vi.fn() };
    const documentService = { getDocument: () => document, flush: vi.fn(async () => undefined) };
    const toolbar = new CanvasNodeToolbarService(documentService as never, history as never, undefined);

    const copiedId = await toolbar.execute('duplicate', webItem.id);
    const command = history.execute.mock.calls[0]?.[0];

    expect(copiedId).toEqual(expect.any(String));
    expect(copiedId).not.toBe(webItem.id);
    expect(command).toMatchObject({
      type: 'create-item',
      item: {
        id: copiedId, kind: 'web-preview', assetId: webItem.assetId, url: webItem.url,
        title: webItem.title, summary: webItem.summary, embeddable: true,
      },
      placement: { itemId: copiedId, x: 132, y: 232, width: 520, height: 360, zIndex: 5 },
    });
    expect(documentService.flush).toHaveBeenCalledTimes(1);
  });

  it('WP-05B: deletes the selected web preview with one delete-item command', async () => {
    const document = { projectId: 'project', items: new Map([[webItem.id, webItem]]), placements: new Map(), connections: new Map(), revision: 0 };
    const history = { execute: vi.fn() };
    const documentService = { getDocument: () => document, flush: vi.fn(async () => undefined) };
    const toolbar = new CanvasNodeToolbarService(documentService as never, history as never, undefined);

    await toolbar.execute('delete', webItem.id);

    expect(history.execute).toHaveBeenCalledTimes(1);
    expect(history.execute.mock.calls[0]?.[0]).toMatchObject({ type: 'delete-item', itemId: webItem.id });
    expect(documentService.flush).toHaveBeenCalledTimes(1);
  });

  it.skip('WP-06: enters iframe interaction only after a second short content click and exits when deselected', () => {
    // Deliberately skipped until WebPreviewNode owns the two-phase iframe
    // interaction state described in docs/web-preview-node-interaction-test-scenarios.md.
  });
});
