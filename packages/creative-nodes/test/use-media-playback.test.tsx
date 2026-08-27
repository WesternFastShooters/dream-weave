import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreativeNodeRuntimeProvider } from '../src/creative-node-context.js';
import { isExpired, useMediaPlayback } from '../src/media/use-media-playback.js';
import type { AssetAccess, IAssetPlaybackService } from '../src/types.js';

afterEach(cleanup);

const future = () => new Date(Date.now() + 300_000).toISOString();
const access = (url: string): AssetAccess => ({ url, expiresAt: future() });

function wrapper(playback: IAssetPlaybackService) {
  return ({ children }: { children: ReactNode }) => createElement(CreativeNodeRuntimeProvider, { value: { playback }, children });
}

describe('useMediaPlayback', () => {
  it('does not request access until the user action calls request', async () => {
    const getPlayback = vi.fn(async () => access('first'));
    const { result } = renderHook(() => useMediaPlayback('asset'), { wrapper: wrapper({ getPlayback }) });
    expect(getPlayback).not.toHaveBeenCalled();
    await act(async () => { await result.current.request(); });
    expect(getPlayback).toHaveBeenCalledTimes(1);
    expect(result.current.access?.url).toBe('first');
  });

  it('deduplicates concurrent initial requests', async () => {
    let resolve!: (value: AssetAccess) => void;
    const pending = new Promise<AssetAccess>((next) => { resolve = next; });
    const getPlayback = vi.fn(() => pending);
    const { result } = renderHook(() => useMediaPlayback('asset'), { wrapper: wrapper({ getPlayback }) });
    let first!: Promise<AssetAccess>; let second!: Promise<AssetAccess>;
    act(() => { first = result.current.request(); second = result.current.request(); });
    expect(getPlayback).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(access('first')); await Promise.all([first, second]); });
  });

  it('refreshes once and makes the second refresh terminal', async () => {
    const getPlayback = vi.fn().mockResolvedValueOnce(access('first')).mockResolvedValueOnce(access('second'));
    const { result } = renderHook(() => useMediaPlayback('asset'), { wrapper: wrapper({ getPlayback }) });
    await act(async () => { await result.current.request(); });
    await act(async () => { await result.current.refreshOnce(); });
    expect(result.current.access?.url).toBe('second');
    await act(async () => { await expect(result.current.refreshOnce()).rejects.toThrow(/刷新后仍不可用/); });
    expect(getPlayback).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('failed');
  });

  it('maps forbidden and not-ready responses to deterministic states', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 });
    const getPlayback = vi.fn().mockRejectedValue(forbidden);
    const { result } = renderHook(() => useMediaPlayback('asset'), { wrapper: wrapper({ getPlayback }) });
    await act(async () => { await expect(result.current.request()).rejects.toBe(forbidden); });
    expect(result.current.phase).toBe('forbidden');
    expect(result.current.errorMessage).toBe('无权播放此媒体');
  });
});

describe('isExpired', () => {
  it('treats invalid and near-expiry timestamps as expired', () => {
    expect(isExpired('invalid')).toBe(true);
    expect(isExpired(new Date(Date.now() + 1_000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});
