import { fireEvent, render, waitFor } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { HtmlViewerNode, ImageNode, OfficeNode, PdfNode } from '../src/nodes.js';
import { DEFAULT_NODE_SIZES, type IAssetPreviewService, type IOfficeViewerSessionProvider } from '../src/types.js';

function wrapper(preview: IAssetPreviewService, office?: IOfficeViewerSessionProvider) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = { _serviceBrand: undefined, onDidChange: new Signal(), getSnapshot: () => snapshot, setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, dispose: () => undefined };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const services = new ServiceCollection();
  services.set(ICanvasInteractionService, interaction);
  services.set(ICanvasEventService, events);
  return ({ children }: { children: ReactNode }) => createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: { preview, office }, children })));
}

describe('resource-node chrome', () => {
  it('renders an uploaded image as an artifact card with its filename outside', async () => {
    const preview: IAssetPreviewService = { getPreview: async () => ({ url: 'https://assets.test/image.png', expiresAt: '2099-01-01T00:00:00Z' }), getHtmlPreview: async () => ({ url: '', expiresAt: '' }) };
    const item = { id: 'image', kind: 'image' as const, title: 'image.png', summary: '', assetId: 'asset', previewAvailable: true, format: 'png', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(ImageNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper: wrapper(preview) });

    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    const title = view.container.querySelector('.dw-resource-node__title');
    expect(title?.textContent).toBe(item.title);
    expect(title?.querySelector('.dw-canvas-node-title__icon path')?.getAttribute('fill')).toBeNull();
    expect(title?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node__surface')?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node__surface img')?.getAttribute('src')).toBe('https://assets.test/image.png');
    expect(view.container.querySelector('.dw-node__header')).toBeNull();
    expect(view.container.querySelector('footer')).toBeNull();
  });

  it('renders an uploaded HTML fallback in the same title-outside artifact frame', () => {
    const preview: IAssetPreviewService = { getPreview: async () => ({ url: '', expiresAt: '' }), getHtmlPreview: async () => ({ url: '', expiresAt: '' }) };
    const item = { id: 'html', kind: 'html' as const, title: 'ex.html', summary: '', assetId: 'asset', previewAvailable: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(HtmlViewerNode, { id: item.id, data: { item }, selected: true, dragging: false } as never), { wrapper: wrapper(preview) });

    const title = view.container.querySelector('.dw-resource-node__title');
    expect(title?.textContent).toBe(item.title);
    expect(title?.querySelector('.dw-canvas-node-title__icon')).not.toBeNull();
    expect(title?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node__surface')?.getAttribute('data-drag-handle')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node--html .dw-html-viewer__fallback')).not.toBeNull();
    expect(view.container.querySelector('.dw-node__header')).toBeNull();
    expect(view.getAllByText(item.title)).toHaveLength(2);
  });

  it('loads the HTML preview capability and renders its sandboxed artifact iframe', async () => {
    const getHtmlPreview = vi.fn().mockResolvedValue({ url: 'https://preview.test/assets/interactive.html', expiresAt: '2099-01-01T00:00:00Z' });
    const preview: IAssetPreviewService = { getPreview: vi.fn(), getHtmlPreview };
    const item = { id: 'html', kind: 'html' as const, title: 'interactive.html', summary: '', assetId: 'html-asset', previewAvailable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(HtmlViewerNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper: wrapper(preview) });

    const frame = await waitFor(() => {
      const element = view.container.querySelector<HTMLIFrameElement>('.dw-html-viewer__frame');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(getHtmlPreview).toHaveBeenCalledOnce();
    expect(getHtmlPreview).toHaveBeenCalledWith(item.assetId);
    expect(frame.getAttribute('src')).toBe('https://preview.test/assets/interactive.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('renders a PDF in the shared read-only ONLYOFFICE resource-card frame', async () => {
    const preview: IAssetPreviewService = { getPreview: async () => ({ url: 'https://assets.test/report.pdf', expiresAt: '2099-01-01T00:00:00Z' }), getHtmlPreview: async () => ({ url: '', expiresAt: '' }) };
    const getSession = vi.fn().mockResolvedValue({ sessionId: 'pdf-session', documentServerUrl: 'https://office.test', documentUrl: 'https://office.test/source', documentKey: 'document-key', token: 'token', documentTitle: 'report.pdf', fileType: 'pdf' as const, documentType: 'pdf' as const, expiresAt: '2099-01-01T00:00:00Z' });
    const office: IOfficeViewerSessionProvider = { getSession };
    const item = { id: 'pdf', kind: 'pdf' as const, title: 'report.pdf', summary: '', assetId: 'asset', previewAvailable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(PdfNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper: wrapper(preview, office) });

    await waitFor(() => expect(view.container.querySelector('.dw-onlyoffice-frame')).not.toBeNull());
    expect(getSession).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledWith(item.assetId);
    const title = view.container.querySelector('.dw-resource-node--pdf .dw-resource-node__title');
    expect(title?.querySelector('.dw-canvas-node-title__icon')).not.toBeNull();
    expect(title?.querySelector('.dw-canvas-node-title__label')?.textContent).toBe(item.title);
    expect(view.container.querySelector('.dw-resource-node--pdf .dw-resource-node__surface')?.getAttribute('data-drag-handle')).not.toBeNull();
    const frame = view.container.querySelector('.dw-resource-node--pdf .dw-onlyoffice-frame');
    expect(frame?.getAttribute('src')).toBe('https://office.test/dw-viewer-shell/pdf-session');
    expect(frame?.getAttribute('aria-hidden')).toBe('true');
    expect(frame?.classList.contains('dw-onlyoffice-frame--ready')).toBe(false);
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://office.test', source: frame?.contentWindow ?? null, data: { type: 'dream-weave:office-preview-ready', sessionId: 'pdf-session' } }));
    await waitFor(() => expect(frame?.classList.contains('dw-onlyoffice-frame--ready')).toBe(true));
    expect(frame?.classList.contains('dw-onlyoffice-frame--ready')).toBe(true);
    const overlay = () => view.container.querySelector('.dw-onlyoffice-frame__interaction-overlay');
    expect(overlay()?.getAttribute('data-drag-handle')).not.toBeNull();
    view.rerender(createElement(PdfNode, { id: item.id, data: { item }, selected: true, dragging: false } as never));
    fireEvent.pointerDown(overlay()!, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay()!, { clientX: 20, clientY: 20 });
    expect(overlay()).toBeNull();
    expect(frame?.classList.contains('dw-onlyoffice-frame--interactive')).toBe(true);
    expect(view.container.querySelector('.react-pdf__Document')).toBeNull();
    expect(view.container.querySelector('.dw-document-node__title')).toBeNull();
  });

  it('renders an Office preview in the resource-card frame with its shared title outside', async () => {
    const preview: IAssetPreviewService = { getPreview: async () => ({ url: '', expiresAt: '' }), getHtmlPreview: async () => ({ url: '', expiresAt: '' }) };
    const getSession = vi.fn().mockResolvedValue({ sessionId: 'office-session', documentServerUrl: 'https://office.test', documentUrl: 'https://office.test/source', documentKey: 'document-key', token: 'token', documentTitle: 'report.docx', fileType: 'docx' as const, documentType: 'word' as const, expiresAt: '2099-01-01T00:00:00Z' });
    const office: IOfficeViewerSessionProvider = { getSession };
    const item = { id: 'office', kind: 'office' as const, title: 'report.docx', summary: '', assetId: 'asset', officeKind: 'word' as const, fileType: 'docx' as const, previewAvailable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(OfficeNode, { id: item.id, data: { item }, selected: false, dragging: false } as never), { wrapper: wrapper(preview, office) });

    await waitFor(() => expect(view.container.querySelector('.dw-onlyoffice-frame')).not.toBeNull());
    expect(getSession).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledWith(item.assetId);
    const title = view.container.querySelector('.dw-resource-node--office .dw-resource-node__title');
    expect(title?.querySelector('.dw-canvas-node-title__icon')).not.toBeNull();
    expect(title?.querySelector('.dw-canvas-node-title__label')?.textContent).toBe(item.title);
    expect(view.container.querySelector('.dw-resource-node--office .dw-resource-node__surface')?.getAttribute('data-drag-handle')).not.toBeNull();
    const frame = view.container.querySelector('.dw-resource-node--office .dw-onlyoffice-frame');
    expect(frame?.getAttribute('src')).toBe('https://office.test/dw-viewer-shell/office-session');
    expect(frame?.classList.contains('nodrag')).toBe(true);
    expect(frame?.classList.contains('nopan')).toBe(true);
    expect(frame?.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.dw-resource-node--office-word')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node--office-spreadsheet, .dw-resource-node--office-presentation')).toBeNull();
    expect(view.container.querySelector('.dw-document-node__title')).toBeNull();
  });

  it('adds layout modifier classes only to their matching Office type', () => {
    const preview: IAssetPreviewService = { getPreview: async () => ({ url: '', expiresAt: '' }), getHtmlPreview: async () => ({ url: '', expiresAt: '' }) };
    const office: IOfficeViewerSessionProvider = { getSession: async () => ({ sessionId: 'office-session', documentServerUrl: 'https://office.test', documentUrl: 'https://office.test/source', documentKey: 'document-key', token: 'token', documentTitle: 'report.xlsx', fileType: 'xlsx', documentType: 'cell', expiresAt: '2099-01-01T00:00:00Z' }) };
    const base = { id: 'office', kind: 'office' as const, summary: '', assetId: 'asset', previewAvailable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const spreadsheet = { ...base, title: 'report.xlsx', officeKind: 'spreadsheet' as const, fileType: 'xlsx' as const };
    const presentation = { ...base, title: 'slides.pptx', officeKind: 'presentation' as const, fileType: 'pptx' as const };
    const view = render(createElement(OfficeNode, { id: spreadsheet.id, data: { item: spreadsheet }, selected: false, dragging: false } as never), { wrapper: wrapper(preview, office) });

    expect(view.container.querySelector('.dw-resource-node--office-spreadsheet')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node--office-presentation')).toBeNull();

    view.rerender(createElement(OfficeNode, { id: presentation.id, data: { item: presentation }, selected: false, dragging: false } as never));
    expect(view.container.querySelector('.dw-resource-node--office-presentation')).not.toBeNull();
    expect(view.container.querySelector('.dw-resource-node--office-spreadsheet')).toBeNull();
  });

  it('uses the image and document defaults for new uploads', () => {
    expect(DEFAULT_NODE_SIZES.image).toEqual([280, 280]);
    expect(DEFAULT_NODE_SIZES.audio).toEqual([640, 280]);
    expect(DEFAULT_NODE_SIZES.html).toEqual([550, 924.333]);
  });
});
