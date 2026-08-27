import { fireEvent, render } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasDocumentService, ICanvasHistoryService, type ICanvasDocumentService as DocumentService, type ICanvasHistoryService as HistoryService } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { MarkdownNode } from '../src/nodes.js';

function wrapper({ children }: { children: ReactNode }) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: ['markdown'], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = { _serviceBrand: undefined, onDidChange: new Signal(), getSnapshot: () => snapshot, setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, dispose: () => undefined };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const document: DocumentService = { _serviceBrand: undefined, onDidChange: new Signal(), onDidConflict: new Signal(), onDidPersistError: new Signal(), initialize: async () => undefined, getDocument: () => ({ projectId: 'project', revision: 0, items: new Map(), placements: new Map(), connections: new Map() }), flush: async () => undefined, dispose: () => undefined };
  const history: HistoryService = { _serviceBrand: undefined, onDidChange: new Signal(), execute: () => undefined, executeBatch: () => undefined, undo: () => false, redo: () => false, canUndo: () => false, canRedo: () => false, dispose: () => undefined };
  const services = new ServiceCollection();
  services.set(ICanvasInteractionService, interaction);
  services.set(ICanvasEventService, events);
  services.set(ICanvasDocumentService, document);
  services.set(ICanvasHistoryService, history);
  return createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: {}, children })));
}

describe('MarkdownNode drag interaction', () => {
  it('keeps a transparent drag overlay while a selected node delegates editing to the canvas drawer', () => {
    const item = { id: 'markdown', kind: 'markdown' as const, title: '文本', summary: '', markdown: '内容', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(MarkdownNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper });
    const content = view.container.querySelector('.dw-product-brief__content')!;
    const overlay = () => view.container.querySelector('.dw-product-brief__interaction-overlay');

    expect(overlay()?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(content.classList.contains('nodrag')).toBe(true);

    fireEvent.pointerDown(overlay()!, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay()!, { clientX: 20, clientY: 20 });
    expect(overlay()).not.toBeNull();

    view.rerender(createElement(MarkdownNode, { id: item.id, data: { item }, selected: true, dragging: false } as never));
    fireEvent.pointerDown(overlay()!, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay()!, { clientX: 28, clientY: 20 });
    expect(overlay()).not.toBeNull();

    fireEvent.pointerDown(overlay()!, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay()!, { clientX: 20, clientY: 20 });

    expect(overlay()).not.toBeNull();
    expect(content.classList.contains('nodrag')).toBe(true);

    fireEvent.pointerDown(document.body);
    expect(overlay()).not.toBeNull();
  });
});
