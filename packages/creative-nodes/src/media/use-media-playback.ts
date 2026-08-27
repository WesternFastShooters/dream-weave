import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreativeNodeRuntime } from '../creative-node-context.js';
import type { AssetAccess } from '../types.js';

export type MediaPlaybackPhase = 'idle' | 'requesting' | 'ready' | 'forbidden' | 'not-ready' | 'failed';

export interface MediaPlaybackState {
  access: AssetAccess | null;
  phase: MediaPlaybackPhase;
  errorMessage: string | null;
}

export interface MediaPlaybackController extends MediaPlaybackState {
  request(): Promise<AssetAccess>;
  refreshOnce(): Promise<AssetAccess>;
  fail(message?: string): void;
}

const EXPIRY_SKEW_MS = 5_000;

/**
 * Owns short-lived playback access only. Media elements remain responsible for
 * capturing currentTime and restoring it after refresh. The first media error
 * may refresh the URL; a second error is terminal for this mounted Asset.
 */
export function useMediaPlayback(assetId: string): MediaPlaybackController {
  const { playback } = useCreativeNodeRuntime();
  const [state, setState] = useState<MediaPlaybackState>({ access: null, phase: 'idle', errorMessage: null });
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const refreshUsedRef = useRef(false);
  const requestRef = useRef<Promise<AssetAccess> | null>(null);
  stateRef.current = state;

  useEffect(() => {
    generationRef.current += 1;
    refreshUsedRef.current = false;
    requestRef.current = null;
    setState({ access: null, phase: 'idle', errorMessage: null });
    return () => { generationRef.current += 1; requestRef.current = null; };
  }, [assetId, playback]);

  const load = useCallback((force: boolean): Promise<AssetAccess> => {
    const existing = stateRef.current.access;
    if (!force && existing && !isExpired(existing.expiresAt)) return Promise.resolve(existing);
    if (!force && requestRef.current) return requestRef.current;
    if (!playback) {
      const error = new Error('媒体播放服务不可用');
      setState({ access: null, phase: 'failed', errorMessage: error.message });
      return Promise.reject(error);
    }
    const generation = generationRef.current;
    setState((current) => ({ access: force ? null : current.access, phase: 'requesting', errorMessage: null }));
    const pending = playback.getPlayback(assetId).then((access) => {
      if (generation === generationRef.current) setState({ access, phase: 'ready', errorMessage: null });
      return access;
    }, (error: unknown) => {
      if (generation === generationRef.current) setState({ access: null, ...stateForError(error) });
      throw error;
    }).finally(() => {
      if (generation === generationRef.current && requestRef.current === pending) requestRef.current = null;
    });
    requestRef.current = pending;
    return pending;
  }, [assetId, playback]);

  const request = useCallback(() => load(false), [load]);
  const refreshOnce = useCallback(() => {
    if (refreshUsedRef.current) {
      const error = new Error('媒体播放地址刷新后仍不可用');
      setState({ access: null, phase: 'failed', errorMessage: error.message });
      return Promise.reject(error);
    }
    refreshUsedRef.current = true;
    requestRef.current = null;
    return load(true);
  }, [load]);
  const fail = useCallback((message = '当前浏览器无法播放此媒体') => {
    setState((current) => ({ access: current.access, phase: 'failed', errorMessage: message }));
  }, []);

  return { ...state, request, refreshOnce, fail };
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= now + EXPIRY_SKEW_MS;
}

function stateForError(error: unknown): Pick<MediaPlaybackState, 'phase' | 'errorMessage'> {
  const value = error as { status?: unknown; code?: unknown };
  if (value?.status === 403) return { phase: 'forbidden', errorMessage: '无权播放此媒体' };
  if (value?.status === 409 || value?.code === 'ASSET_NOT_READY') return { phase: 'not-ready', errorMessage: '媒体仍在处理中' };
  return { phase: 'failed', errorMessage: '当前浏览器无法播放此媒体' };
}
