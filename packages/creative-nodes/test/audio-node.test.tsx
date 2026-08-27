import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Signal } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService, type CanvasInteractionSnapshot, type ICanvasEventService as EventService, type ICanvasInteractionService as InteractionService } from '@dream-weave/canvas-interaction';
import { InstantiationContext, InstantiationService, ServiceCollection } from '@dream-weave/di';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { AudioNode } from '../src/nodes.js';
import type { IAssetPlaybackService } from '../src/types.js';

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); }) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); }) });
});

function providers(playback: IAssetPlaybackService) {
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
  return ({ children }: { children: ReactNode }) => createElement(ReactFlowProvider, null, createElement(InstantiationContext, { instantiationService: instantiation }, createElement(CreativeNodeRuntimeProvider, { value: { playback }, children })));
}

function renderAudio(playback: IAssetPlaybackService, selected = false) {
  const item = { id: 'node', kind: 'audio' as const, title: 'recording', summary: '', assetId: 'asset', format: 'mp3', durationMs: 10_000, waveform: Array(64).fill(0.5), sceneLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  return render(createElement(AudioNode, { id: 'node', data: { item }, selected, dragging: false } as never), { wrapper: providers(playback) });
}

function access(url: string) { return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() }; }

async function unlockAudio(view: ReturnType<typeof renderAudio>) {
  const overlay = view.container.querySelector<HTMLElement>('.dw-audio-node__interaction-overlay');
  expect(overlay).not.toBeNull();
  fireEvent.pointerDown(overlay!, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(overlay!, { button: 0, clientX: 10, clientY: 10 });
  await waitFor(() => expect(view.container.querySelector('.dw-audio-node__interaction-overlay')).toBeNull());
}

describe('AudioNode', () => {
  it('renders the supplied audio-file icon beside the file name', () => {
    const view = renderAudio({ getPlayback: vi.fn(async () => access('https://preview.localhost/audio')) });
    expect(view.container.querySelector('.dw-audio-node__title .dw-canvas-node-title__icon')).not.toBeNull();
    expect(view.container.querySelector('.dw-audio-node__title .dw-canvas-node-title__label')?.textContent).toBe('recording');
    expect(view.container.querySelector('.dw-audio-node__surface')).not.toBeNull();
    expect(view.queryByText('mp3')).toBeNull();
  });

  it('keeps controls covered until a selected node receives a second short click', async () => {
    const unselected = renderAudio({ getPlayback: vi.fn(async () => access('https://preview.localhost/audio')) });
    const overlay = unselected.container.querySelector<HTMLElement>('.dw-audio-node__interaction-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay!, { button: 0, clientX: 10, clientY: 10 });
    expect(unselected.container.querySelector('.dw-audio-node__interaction-overlay')).not.toBeNull();
    unselected.unmount();

    const selected = renderAudio({ getPlayback: vi.fn(async () => access('https://preview.localhost/audio')) }, true);
    await unlockAudio(selected);
  });

  it('plays through a native audio element after requesting capability access', async () => {
    const getPlayback = vi.fn(async () => access('https://preview.localhost/audio'));
    const view = renderAudio({ getPlayback }, true);
    expect(view.container.querySelector('.dw-audio-node__controls')).not.toBeNull();
    await unlockAudio(view);
    fireEvent.click(screen.getByRole('button', { name: '播放音频' }));
    await waitFor(() => expect(view.container.querySelector('audio')).not.toBeNull());
    const audio = view.container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(audio);
    await screen.findByRole('button', { name: '暂停音频' });
    fireEvent.input(screen.getByRole('slider', { name: '音频进度' }), { target: { value: '1000' } });
    expect(audio.currentTime).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '暂停音频' }));
    expect(getPlayback).toHaveBeenCalledTimes(1);
  });

  it('pauses playback when the audio node is deselected', async () => {
    const playback = { getPlayback: vi.fn(async () => access('https://preview.localhost/audio')) };
    const view = renderAudio(playback, true);
    await unlockAudio(view);
    fireEvent.click(screen.getByRole('button', { name: '播放音频' }));
    await waitFor(() => expect(view.container.querySelector('audio')).not.toBeNull());
    const audio = view.container.querySelector('audio')!;
    fireEvent.loadedMetadata(audio);
    await screen.findByRole('button', { name: '暂停音频' });

    view.rerender(createElement(AudioNode, { id: 'node', data: { item: { id: 'node', kind: 'audio', title: 'recording', summary: '', assetId: 'asset', format: 'mp3', durationMs: 10_000, waveform: Array(64).fill(0.5), sceneLabel: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } }, selected: false, dragging: false } as never));

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: '播放音频' });
  });

  it('refreshes the source once after a media error and resumes at the saved position', async () => {
    const getPlayback = vi.fn().mockResolvedValueOnce(access('https://preview.localhost/first')).mockResolvedValueOnce(access('https://preview.localhost/second'));
    const view = renderAudio({ getPlayback }, true);
    await unlockAudio(view);
    fireEvent.click(screen.getByRole('button', { name: '播放音频' }));
    await waitFor(() => expect(view.container.querySelector('audio')).not.toBeNull());
    let audio = view.container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(audio); audio.currentTime = 3; fireEvent.timeUpdate(audio);
    fireEvent.error(audio);
    await waitFor(() => expect(getPlayback).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('https://preview.localhost/second'));
    audio = view.container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(3);
  });
});
