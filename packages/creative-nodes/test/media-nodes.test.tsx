import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { type CanvasItem, Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { AudioNode, VideoNode } from '../src/nodes.js';
import type { AssetAccess, NodeRuntimeServices } from '../src/types.js';

const future = () => new Date(Date.now() + 300_000).toISOString();
const playbackAccess = (url: string): AssetAccess => ({ url, expiresAt: future() });

const audioItem: Extract<CanvasItem, { kind: 'audio' }> = {
  id: 'audio-asset', kind: 'audio', title: '环境音.mp3', summary: '', assetId: 'audio-asset', format: 'mp3', durationMs: 90_000,
  waveform: [0.25, 0.5, 0.75], sceneLabel: '雨声', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const videoItem: Extract<CanvasItem, { kind: 'video' }> = {
  id: 'video-asset', kind: 'video', title: '片段.mp4', summary: '', assetId: 'video-asset', posterAvailable: true, durationMs: 90_000,
  shotLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function createHarness(runtime: NodeRuntimeServices, itemId: string) {
  const snapshot: CanvasInteractionSnapshot = { selectedItemIds: [itemId], viewport: { x: 0, y: 0, zoom: 1 }, isDragging: false, toolMode: 'pointer' };
  const interaction: InteractionService = {
    _serviceBrand: undefined, onDidChange: new Signal(), onDidRequestNodeResize: new Signal(), getSnapshot: () => snapshot,
    setSelectedItemIds: () => undefined, setViewport: () => undefined, setDragging: () => undefined, setToolMode: () => undefined, requestNodeResize: () => undefined, dispose: () => undefined,
  };
  const events: EventService = { _serviceBrand: undefined, onDidRequest: new Signal(), onDidNotify: new Signal(), request: () => undefined, notify: () => undefined, dispose: () => undefined };
  const services = new ServiceCollection();
  services.set(ICanvasInteractionService, interaction);
  services.set(ICanvasEventService, events);
  return ({ children }: { children: ReactNode }) => createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: new InstantiationService(services) }, createElement(CreativeNodeRuntimeProvider, { value: runtime }, children)));
}

function exposeMediaMetadata(media: HTMLMediaElement, duration: number) {
  Object.defineProperties(media, {
    duration: { configurable: true, value: duration },
    currentTime: { configurable: true, writable: true, value: 0 },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('media nodes', () => {
  it('loads and renders an audio resource, then supports play, pause, and seeking', async () => {
    const getPlayback = vi.fn().mockResolvedValue(playbackAccess('https://media.example/audio.mp3'));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const view = render(createElement(AudioNode, { id: audioItem.id, data: { item: audioItem }, selected: true, dragging: false } as never), { wrapper: createHarness({ playback: { getPlayback } }, audioItem.id) });

    expect(view.getByText('雨声')).toBeTruthy();
    expect(view.getByLabelText('音频进度')).toHaveProperty('disabled', false);
    fireEvent.click(view.getByLabelText('播放音频'));

    const audio = await waitFor(() => {
      const element = view.container.querySelector('audio');
      expect(element).not.toBeNull();
      return element as HTMLAudioElement;
    });
    expect(getPlayback).toHaveBeenCalledWith(audioItem.assetId);
    expect(audio.getAttribute('src')).toBe('https://media.example/audio.mp3');

    exposeMediaMetadata(audio, 90);
    fireEvent.loadedMetadata(audio);
    await waitFor(() => expect(play).toHaveBeenCalledWith());
    fireEvent.play(audio);
    expect(view.getByLabelText('暂停音频')).toBeTruthy();

    const progress = view.getByLabelText('音频进度') as HTMLInputElement;
    fireEvent.input(progress, { target: { value: '45000' } });
    expect(progress.value).toBe('45000');
    expect(audio.currentTime).toBe(45);

    fireEvent.click(view.getByLabelText('暂停音频'));
    expect(pause).toHaveBeenCalledWith();
  });

  it('loads and renders a video resource, then supports play, pause, and committed seeking', async () => {
    const getPlayback = vi.fn().mockResolvedValue(playbackAccess('https://media.example/video.mp4'));
    const getPreview = vi.fn().mockResolvedValue(playbackAccess('https://media.example/video-poster.jpg'));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const view = render(createElement(VideoNode, { id: videoItem.id, data: { item: videoItem }, selected: true, dragging: false } as never), { wrapper: createHarness({ playback: { getPlayback }, preview: { getPreview, getHtmlPreview: vi.fn() } }, videoItem.id) });

    await waitFor(() => expect(getPreview).toHaveBeenCalledWith(videoItem.assetId));
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://media.example/video-poster.jpg');
    fireEvent.click(view.getByLabelText('播放视频'));

    const video = await waitFor(() => {
      const element = view.container.querySelector('video');
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });
    expect(getPlayback).toHaveBeenCalledWith(videoItem.assetId);
    expect(video.getAttribute('src')).toBe('https://media.example/video.mp4');

    exposeMediaMetadata(video, 90);
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(play).toHaveBeenCalledWith());
    fireEvent.play(video);
    expect(view.getByLabelText('暂停视频')).toBeTruthy();

    const progress = view.getByLabelText('视频进度') as HTMLInputElement;
    fireEvent.input(progress, { target: { value: '35000' } });
    expect(progress.value).toBe('35000');
    expect(video.currentTime).toBe(0);
    fireEvent.pointerUp(progress);
    expect(video.currentTime).toBe(35);

    fireEvent.click(view.getByLabelText('暂停视频'));
    expect(pause).toHaveBeenCalledWith();
  });
});
