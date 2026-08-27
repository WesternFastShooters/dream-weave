import { fireEvent, render, waitFor } from '@testing-library/react';
import { Signal, type CanvasDocument, type CanvasItem, type Placement } from '@dream-weave/canvas-core';
import { ICanvasDocumentService, ICanvasHistoryService, type ICanvasDocumentService as DocumentService, type ICanvasHistoryService as HistoryService } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSideDrawerProvider } from '../src/canvas-side-drawer.js';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { MarkdownNode } from '../src/nodes.js';

const item: Extract<CanvasItem, { kind: 'markdown' }> = {
  id: 'markdown', kind: 'markdown', title: '文本', summary: '', markdown: '初始内容', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const placement: Placement = { itemId: item.id, x: 100, y: 100, width: 550, height: 100, zIndex: 1 };

function createHarness() {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [item.id], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const requestNodeResize = vi.fn();
  const interaction: InteractionService = { _serviceBrand: undefined, onDidChange: new Signal(), onDidRequestNodeResize: new Signal(), getSnapshot: () => snapshot, setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, requestNodeResize, dispose: () => undefined };
  const request = vi.fn();
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request, notify: () => undefined, dispose: () => undefined };
  const document: CanvasDocument = { projectId: 'project', revision: 0, items: new Map([[item.id, item]]), placements: new Map([[item.id, placement]]), connections: new Map() };
  const documentService: DocumentService = { _serviceBrand: undefined, onDidChange: new Signal(), onDidConflict: new Signal(), onDidPersistError: new Signal(), initialize: async () => undefined, getDocument: () => document, flush: async () => undefined, dispose: () => undefined };
  const execute = vi.fn();
  const history: HistoryService = { _serviceBrand: undefined, onDidChange: new Signal(), execute, executeBatch: () => undefined, undo: () => false, redo: () => false, canUndo: () => false, canRedo: () => false, dispose: () => undefined };
  const updateMarkdown = vi.fn();
  const services = new ServiceCollection();
  services.set(ICanvasInteractionService, interaction); services.set(ICanvasEventService, events); services.set(ICanvasDocumentService, documentService); services.set(ICanvasHistoryService, history);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: { markdown: { updateMarkdown } } }, createElement(CanvasSideDrawerProvider, null, children))));
  return { execute, request, requestNodeResize, updateMarkdown, wrapper };
}

describe('MarkdownNode editor lifecycle', () => {
  it('reselects itself before honoring a start-editing instruction', () => {
    const harness = createHarness();
    render(createElement(MarkdownNode, { id: item.id, data: { item, startEditing: true }, selected: false, dragging: false } as never), { wrapper: harness.wrapper });

    expect(harness.request).toHaveBeenCalledWith({ type: 'select-items', itemIds: [item.id] });
  });

  it('keeps the node iframe readonly and mounts the sole drawer editor directly', async () => {
    const harness = createHarness();
    const view = render(createElement('div', { className: 'react-flow__node' }, createElement(MarkdownNode, { id: item.id, data: { item }, selected: true, dragging: false } as never)), { wrapper: harness.wrapper });
    const overlay = () => view.container.querySelector<HTMLElement>('.dw-product-brief__interaction-overlay');
    const previewFrame = view.container.querySelector<HTMLIFrameElement>('iframe.dw-markdown-editor-frame')!;

    const firstPaint = view.container.querySelector('.dw-markdown-first-paint');
    expect(firstPaint?.textContent).toBe('初始内容');
    expect(firstPaint?.querySelectorAll('p')).toHaveLength(1);
    expect(overlay()).not.toBeNull();
    fireEvent.pointerDown(overlay()!, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay()!, { clientX: 20, clientY: 20 });
    expect(overlay()).not.toBeNull();
    const drawer = view.container.querySelector<HTMLElement>('[data-canvas-side-drawer]')!;
    expect(drawer.querySelector('iframe.dw-markdown-editor-frame--drawer')).toBeNull();
    await waitFor(() => expect(drawer.querySelector('.dw-markdown-drawer-editor .ProseMirror')).not.toBeNull());
    const editor = drawer.querySelector<HTMLElement>('.dw-markdown-drawer-editor .ProseMirror')!;
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(view.container.querySelector('[data-canvas-side-drawer]')).toBeNull());
    expect(harness.updateMarkdown).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
    expect(overlay()).not.toBeNull();
    expect(previewFrame).not.toBeNull();
  });
});
