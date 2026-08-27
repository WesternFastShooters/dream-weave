import { render, screen } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { CanvasNodeToolbarService } from '../src/creative-node-service.js';
import { WebPreviewNode } from '../src/nodes.js';

function wrapper({ children }: { children: ReactNode }) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = { _serviceBrand: undefined, onDidChange: new Signal(), getSnapshot: () => snapshot, setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, dispose: () => undefined };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const services = new ServiceCollection(); services.set(ICanvasInteractionService, interaction); services.set(ICanvasEventService, events);
  return createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: {}, children })));
}

describe('WebPreviewNode', () => {
  it('limits the toolbar to canvas actions', () => {
    const item = { id: 'web', kind: 'web-preview' as const, title: 'Example', summary: '', assetId: 'asset', url: 'https://example.test/path', embeddable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const toolbar = new CanvasNodeToolbarService({} as never, {} as never, undefined);

    expect(toolbar.getActions(item).map((action) => action.id)).toEqual(['duplicate', 'delete']);
  });

  it('keeps the iframe in the resource-card frame without adding a loading message', () => {
    const item = { id: 'web', kind: 'web-preview' as const, title: 'Example', summary: '', assetId: 'asset', url: 'https://example.test/path', embeddable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(WebPreviewNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper });
    const frame = view.container.querySelector('iframe')!;
    expect(view.container.querySelector('iframe')).toBe(frame);
    expect(screen.queryByText('加载时间较长，仍在尝试显示网页。')).toBeNull();
    const title = view.container.querySelector('.dw-resource-node--web-preview .dw-resource-node__title');
    expect(title?.textContent).toBe(item.title);
    expect(title?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(title?.querySelector('.dw-canvas-node-title__icon')).not.toBeNull();
    expect(title?.querySelector('.dw-canvas-node-title__label')?.textContent).toBe(item.title);
    expect(view.container.querySelector('.dw-resource-node--web-preview .dw-resource-node__surface')?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(view.container.querySelector('.dw-node__header')).toBeNull();
    expect(screen.queryByRole('link', { name: '在新标签页打开' })).toBeNull();
    expect(view.container.querySelector('.dw-node')?.getAttribute('data-node-kind')).toBe('web-preview');
  });
});
