import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { VideoNode } from '../src/nodes.js';
import type { IAssetPlaybackService, IAssetPreviewService } from '../src/types.js';

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); }) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); }) });
});

function providers(playback: IAssetPlaybackService, preview?: IAssetPreviewService) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = {
    _serviceBrand: undefined,
    onDidChange: new Signal<CanvasInteractionSnapshot>(),
    getSnapshot: () => snapshot,
    setSelectedItemIds: () => undefined,
    setViewport: () => undefined,
    setDragging: () => undefined,
    setToolMode: () => undefined,
    dispose: () => undefined,
  };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const services = new ServiceCollection(); services.set(ICanvasInteractionService, interaction); services.set(ICanvasEventService, events);
  const instantiation = new InstantiationService(services);
  return ({ children }: { children: ReactNode }) => createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: instantiation }, createElement(CreativeNodeRuntimeProvider, { value: { playback, preview }, children })));
}

function renderVideo(playback: IAssetPlaybackService, selected = false) {
  const item = { id: 'node', kind: 'video' as const, title: 'clip', summary: '', assetId: 'asset', posterAvailable: false, durationMs: 10_000, shotLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  return render(createElement(VideoNode, { id: 'node', data: { item }, selected, dragging: false } as never), { wrapper: providers(playback) });
}

function access(url: string) { return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() }; }

describe('VideoNode', () => {
  it('uses the compact video chrome and leaves the node shell draggable', () => {
    const view = renderVideo({ getPlayback: vi.fn(async () => access('https://media.test/first')) });
    expect(screen.getByText('clip')).toBeTruthy();
    expect(view.container.querySelector('.dw-video-node__title')?.getAttribute('title')).toBe('clip');
    expect(view.container.querySelector('article.dw-node[data-drag-handle]')).not.toBeNull();
    expect(view.container.querySelector('.dw-video-node__title .dw-canvas-node-title__icon path')).not.toBeNull();
  });

  it('does not let a poster image start the browser native image drag', async () => {
    const getPreview = vi.fn(async () => access('https://media.test/poster'));
    const item = { id: 'node', kind: 'video' as const, title: 'clip', summary: '', assetId: 'asset', posterAvailable: true, durationMs: 10_000, shotLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const view = render(createElement(VideoNode, { id: 'node', data: { item }, selected: false, dragging: false } as never), { wrapper: providers({ getPlayback: vi.fn(async () => access('https://media.test/video')) }, { getPreview, getHtmlPreview: getPreview }) });
    await waitFor(() => expect(view.container.querySelector('.dw-video-poster img')).not.toBeNull());
    expect(view.container.querySelector('.dw-video-poster img')?.getAttribute('draggable')).toBe('false');
  });

  it('requires a second short click before video controls become interactive', async () => {
    const getPlayback = vi.fn(async () => access('https://media.test/first'));
    const view = renderVideo({ getPlayback }, true);
    const overlay = view.container.querySelector('.dw-video-node__interaction-overlay')!;
    fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay, { button: 0, clientX: 20, clientY: 20 });
    await waitFor(() => expect(view.container.querySelector('.dw-video-node__interaction-overlay')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    await waitFor(() => expect(getPlayback).toHaveBeenCalledTimes(1));
  });

  it('requests on click and can play again after pausing', async () => {
    const getPlayback = vi.fn(async () => access('https://media.test/first'));
    const view = renderVideo({ getPlayback });
    expect(getPlayback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
    const video = view.container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(video);
    await screen.findByRole('button', { name: '暂停视频' });
    fireEvent.click(screen.getByRole('button', { name: '暂停视频' }));
    fireEvent.click(await screen.findByRole('button', { name: '播放视频' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(getPlayback).toHaveBeenCalledTimes(1);
  });

  it('pauses playback when the video node is deselected', async () => {
    const playback = { getPlayback: vi.fn(async () => access('https://media.test/first')) };
    const view = renderVideo(playback, true);
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
    const video = view.container.querySelector('video')!;
    fireEvent.loadedMetadata(video);
    await screen.findByRole('button', { name: '暂停视频' });

    view.rerender(createElement(VideoNode, { id: 'node', data: { item: { id: 'node', kind: 'video', title: 'clip', summary: '', assetId: 'asset', posterAvailable: false, durationMs: 10_000, shotLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } }, selected: false, dragging: false } as never));

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: '播放视频' });
  });

  it('refreshes once, restores currentTime, and makes the second media error terminal', async () => {
    const getPlayback = vi.fn().mockResolvedValueOnce(access('https://media.test/first')).mockResolvedValueOnce(access('https://media.test/second'));
    const view = renderVideo({ getPlayback });
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
    let video = view.container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(video); video.currentTime = 3; fireEvent.timeUpdate(video);
    await act(async () => { fireEvent.error(video); });
    await waitFor(() => expect(getPlayback).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toBe('https://media.test/second'));
    video = view.container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(3);
    await act(async () => { fireEvent.error(video); });
    await screen.findByText('媒体播放地址刷新后仍不可用');
    expect(getPlayback).toHaveBeenCalledTimes(2);
  });
});
