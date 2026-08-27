import { ICanvasDocumentService, ICanvasHistoryService, type CanvasItem } from '@dream-weave/canvas-core';
import { NodeToolbar, Position, useReactFlow, useViewport, type Node, type NodeProps } from '@xyflow/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCanvasNodeFrameStyle } from '@dream-weave/canvas-renderer';
import { ICanvasEventService, ICanvasInteractionService } from '@dream-weave/canvas-interaction';
import { useService } from '@dream-weave/di';
import { CanvasNodeHoverToolbarView } from './canvas-node-hover-toolbar-view.js';
import { CanvasNodeTitle, CanvasNodeTypeIcon } from './canvas-node-title.js';
import { isExpired, useMediaPlayback } from './media/use-media-playback.js';

import { useCreativeNodeRuntime } from './creative-node-context.js';
import { useCanvasSideDrawer } from './canvas-side-drawer.js';
import type { NodeToolbarActionId, OfficeViewerSessionRuntimeConfig } from './types.js';

type FlowNode = Node<{ item: CanvasItem; startEditing?: boolean }>;
type Props = NodeProps<FlowNode>;

function NodeShell({ children, selected, dragging, data, toolbarVisible = true }: Props & { children: React.ReactNode; toolbarVisible?: boolean }) {
  const item = data.item;
  const isResourceNode = item.kind === 'image' || item.kind === 'audio' || item.kind === 'html' || item.kind === 'video' || item.kind === 'web-preview' || item.kind === 'pdf' || item.kind === 'office';
  const { zoom } = useViewport();
  const runtime = useCreativeNodeRuntime();
  const interaction = useService(ICanvasInteractionService);
  const events = useService(ICanvasEventService);
  const [interactionSnapshot, setInteractionSnapshot] = useState(() => interaction.getSnapshot());
  const [toolbarPosition, setToolbarPosition] = useState(Position.Top);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => interaction.onDidChange.subscribe(setInteractionSnapshot).dispose, [interaction]);
  const actions = runtime.toolbar?.getActions(item) ?? [];
  const showToolbar = toolbarVisible && selected && !dragging && interactionSnapshot.toolMode === 'pointer' && interactionSnapshot.selectedItemIds.length === 1;
  // NodeToolbar inverse-scales itself, so the Markdown header must be converted
  // to viewport pixels to preserve its visual gap at every canvas zoom level.
  const markdownToolbarMargin = toolbarPosition === Position.Top && item.kind === 'markdown' ? 36 * zoom : undefined;
  useEffect(() => {
    if (!showToolbar) return;
    const frame = requestAnimationFrame(() => setToolbarPosition((root.current?.getBoundingClientRect().top ?? 56) < 56 ? Position.Bottom : Position.Top));
    return () => cancelAnimationFrame(frame);
  }, [showToolbar]);
  const executeToolbarAction = async (actionId: string) => {
    if (busyActionId) return;
    setBusyActionId(actionId);
    setActionError(null);
    try {
      const createdItemId = await runtime.toolbar?.execute(actionId as NodeToolbarActionId, item.id);
      if (createdItemId) events.request({ type: 'select-items', itemIds: [createdItemId] });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请重试。';
      setActionError(message);
      runtime.onToast?.(message);
    }
    finally { setBusyActionId(null); }
  };
  return <article ref={root} className="dw-node" data-node-kind={item.kind} data-drag-handle={item.kind === 'video' ? '' : undefined} style={item.kind === 'markdown' || isResourceNode ? undefined : { ...getCanvasNodeFrameStyle({ selected, dragging }), ...(item.kind === 'frame' ? { minWidth: 0, minHeight: 0 } : {}) }}>
    {showToolbar && actions.length > 0 && <NodeToolbar nodeId={item.id} isVisible position={toolbarPosition} offset={22} style={markdownToolbarMargin === undefined ? undefined : { marginTop: markdownToolbarMargin }} className="dw-node-toolbar-portal"><CanvasNodeHoverToolbarView actions={actions} busyActionId={busyActionId as NodeToolbarActionId | null} tooltipPosition={toolbarPosition === Position.Bottom ? 'bottom' : 'top'} onAction={(action) => void executeToolbarAction(action.id)} /></NodeToolbar>}
    {actionError && <div role="alert" style={{ position: 'absolute', right: 16, bottom: 12, zIndex: 30, borderRadius: 6, background: '#152238', color: '#fff', padding: '5px 8px', fontSize: 12 }}>{actionError}</div>}
    {children}
  </article>;
}
function Empty({ children = '预览不可用' }: { children?: React.ReactNode }) { return <div className="dw-node__empty">{children}</div>; }
function ResourceNodeFrame({ item, selected, dragging, children }: { item: Extract<CanvasItem, { kind: 'image' | 'html' | 'web-preview' | 'pdf' | 'office' }>; selected: boolean; dragging?: boolean; children: React.ReactNode }) {
  // Resource nodes keep their filename outside the rendered artifact so
  // an image or uploaded page owns the entire card surface.
  const frameStyle = item.kind === 'html' && !selected && !dragging ? undefined : getCanvasNodeFrameStyle({ selected, dragging });
  const officeKindClass = item.kind === 'office' ? ` dw-resource-node--office-${item.officeKind}` : '';
  return <div className={`dw-resource-node dw-resource-node--${item.kind}${officeKindClass}`}>
    <CanvasNodeTitle className="dw-resource-node__title" data-drag-handle kind={item.kind} officeFileType={item.kind === 'office' ? item.fileType : undefined} title={item.title} />
    <div className="dw-resource-node__surface" data-drag-handle style={frameStyle}>{children}</div>
  </div>;
}
function useAssetUrl(assetId: string, enabled: boolean, html = false): { url: string | null; failed: boolean } {
  const { preview } = useCreativeNodeRuntime(); const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    let active = true; let retryTimer: number | undefined; let attempts = 0;
    setState({ url: null, failed: false });
    if (!enabled || !preview) return;
    const load = () => { void (html ? preview.getHtmlPreview(assetId) : preview.getPreview(assetId)).then(
      (result) => { if (active) setState({ url: result.url, failed: false }); },
      (error: unknown) => {
        if (!active) return;
        // Authorization failures are terminal. Repeating a signed-access request
        // every second only creates noise and cannot restore permission.
        if (isHttpStatus(error, 403)) { setState({ url: null, failed: true }); return; }
        attempts += 1;
        if (attempts < 10) retryTimer = window.setTimeout(load, 1_000);
        else setState({ url: null, failed: true });
      },
    ); };
    load();
    return () => { active = false; if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [assetId, enabled, html, preview]);
  return state;
}
type MarkdownFrameMessage = {
  type: string;
  sessionId: string;
  markdown?: string;
  editable?: boolean;
};
type MarkdownFrameCommand = Omit<MarkdownFrameMessage, 'sessionId'>;

export function MarkdownNode(props: Props) {
  const item = props.data.item; if (item.kind !== 'markdown') return null;
  const [failed, setFailed] = useState(false); const [frameHydrated, setFrameHydrated] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const persistedRef = useRef(item.markdown); const itemRef = useRef(item); const runtime = useCreativeNodeRuntime(); const documentService = useService(ICanvasDocumentService);
  const events = useService(ICanvasEventService); const drawer = useCanvasSideDrawer();
  const overlayPointer = useRef<{ x: number; y: number; wasSelected: boolean } | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  itemRef.current = item;
  const previewMarkdown = drawer.markdownDrafts.get(item.id) ?? item.markdown;
  const previewMarkdownRef = useRef(previewMarkdown);
  previewMarkdownRef.current = previewMarkdown;
  const frameUrl = runtime.markdownEditorFrameUrl ?? '/markdown-editor-frame.html';
  const frameSrc = useMemo(() => {
    const url = new URL(frameUrl, window.location.href);
    url.searchParams.set('session', sessionId.current);
    return url.href;
  }, [frameUrl]);
  const postToFrame = useCallback((message: MarkdownFrameCommand) => {
    frame.current?.contentWindow?.postMessage({ ...message, sessionId: sessionId.current }, '*');
  }, []);
  const initializeFrame = useCallback(() => {
    postToFrame({ type: 'dream-weave:markdown:init', markdown: previewMarkdownRef.current, editable: false });
  }, [postToFrame]);
  useEffect(() => {
    if (!props.data.startEditing || failed) return;
    // Directional creation can receive a delayed React Flow selection update.
    // Reassert the editing node as selected so focus and the blue canvas frame
    // always identify the same text node.
    events.request({ type: 'select-items', itemIds: [item.id] });
    drawer.openMarkdown(item.id);
  }, [drawer, events, failed, item.id, props.data.startEditing]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<MarkdownFrameMessage>) => {
      const message = event.data;
      if (!message || event.source !== frame.current?.contentWindow || message.sessionId !== sessionId.current) return;
      switch (message.type) {
        case 'dream-weave:markdown:ready':
          initializeFrame();
          break;
        case 'dream-weave:markdown:hydrated':
          setFrameHydrated(true);
          break;
        case 'dream-weave:markdown:failed':
          setFailed(true);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [initializeFrame]);
  useEffect(() => documentService.onDidConflict.subscribe(() => {
    const reloaded = documentService.getDocument().items.get(itemRef.current.id);
    if (!reloaded || reloaded.kind !== 'markdown') return;
    persistedRef.current = reloaded.markdown;
    postToFrame({ type: 'dream-weave:markdown:set-markdown', markdown: reloaded.markdown });
  }).dispose, [documentService, postToFrame]);
  useEffect(() => {
    if (item.markdown === persistedRef.current) return;
    persistedRef.current = item.markdown;
    postToFrame({ type: 'dream-weave:markdown:set-markdown', markdown: item.markdown });
  }, [item.markdown, postToFrame]);
  useEffect(() => {
    postToFrame({ type: 'dream-weave:markdown:set-markdown', markdown: previewMarkdown });
  }, [postToFrame, previewMarkdown]);
  const beginOverlayPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    overlayPointer.current = event.button === 0 ? { x: event.clientX, y: event.clientY, wasSelected: props.selected } : null;
  }, [props.selected]);
  const endOverlayPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = overlayPointer.current;
    overlayPointer.current = null;
    if (!pointer || !pointer.wasSelected || failed || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) return;
    drawer.openMarkdown(item.id);
  }, [drawer, failed, item.id]);
  // Canvas text nodes are previews only. Editing is deliberately isolated in
  // the canvas-level drawer so every Milkdown menu stays inside one iframe.
  const showReadonlyPlaceholder = !failed && previewMarkdown.trim().length === 0;
  return <NodeShell {...props}>
    <>
      <div className="dw-product-brief">
        <CanvasNodeTitle className="dw-product-brief__header" data-drag-handle kind="markdown" title="文本" />
        <div className={`dw-product-brief__surface${props.selected ? ' is-selected' : ''}`} style={getCanvasNodeFrameStyle({ selected: props.selected, dragging: props.dragging })}>
          <div className="dw-product-brief__content nodrag nowheel is-readonly">
            {failed ? <div className="dw-milkdown" role="textbox" aria-readonly="true">{previewMarkdown}</div> : <iframe ref={frame} className={`dw-markdown-editor-frame${frameHydrated ? ' is-hydrated' : ''}`} title="Markdown 预览" src={frameSrc} sandbox="allow-scripts" referrerPolicy="no-referrer" aria-busy={!frameHydrated} onLoad={initializeFrame} />}
            {!failed && !frameHydrated && previewMarkdown.trim().length > 0 && <MarkdownFirstPaint markdown={previewMarkdown} />}
            {showReadonlyPlaceholder && <div className="dw-product-brief__empty-placeholder" aria-hidden="true">输入 Markdown，使用 / 插入块</div>}
          </div>
          <div className="dw-product-brief__interaction-overlay" data-drag-handle aria-label="选择或拖拽文本节点" onPointerDown={beginOverlayPointer} onPointerUp={endOverlayPointer} />
        </div>
      </div>
    </>
  </NodeShell>;
}

/** Mirrors the readonly Crepe paragraph box for the frame's first paint. */
function MarkdownFirstPaint({ markdown }: { markdown: string }) {
  const paragraphs = markdown.split(/\r?\n\s*\r?\n/);
  return <div className="dw-markdown-first-paint" aria-hidden="true">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}
export function ImageNode(props: Props) {
  const item = props.data.item;
  if (item.kind !== 'image') return null;
  const preview = useAssetUrl(item.assetId, item.previewAvailable);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => setLoadFailed(false), [preview.url]);
  return <NodeShell {...props}><ResourceNodeFrame item={item} selected={props.selected} dragging={props.dragging}>
    {preview.url && !preview.failed && !loadFailed ? <img className="dw-image nowheel" data-drag-handle src={preview.url} alt={item.title} onError={() => setLoadFailed(true)} /> : <Empty />}
  </ResourceNodeFrame></NodeShell>;
}
export function AudioNode(props: Props) {
  const item = props.data.item; if (item.kind !== 'audio') return null;
  const media = useRef<HTMLAudioElement>(null);
  const shouldPlay = useRef(false); const recovering = useRef(false); const currentRef = useRef(0); const playingRef = useRef(false); const resumeAt = useRef(0);
  const interactionPointer = useRef<{ x: number; y: number; wasSelected: boolean } | null>(null);
  const playback = useMediaPlayback(item.assetId); const [playing, setPlaying] = useState(false); const [interacting, setInteracting] = useState(false); const [current, setCurrent] = useState(0); const [duration, setDuration] = useState(item.durationMs / 1000);
  useEffect(() => { media.current?.pause(); setDuration(item.durationMs / 1000); setCurrent(0); setInteracting(false); currentRef.current = 0; setPlaying(false); playingRef.current = false; shouldPlay.current = false; resumeAt.current = 0; recovering.current = false; }, [item.assetId, item.durationMs]);
  useEffect(() => {
    if (props.selected) return;
    shouldPlay.current = false;
    recovering.current = false;
    media.current?.pause();
    playingRef.current = false;
    setPlaying(false);
    setInteracting(false);
  }, [props.selected]);
  const recover = useCallback(async () => {
    if (recovering.current) return;
    recovering.current = true; resumeAt.current = media.current?.currentTime ?? currentRef.current; shouldPlay.current = playingRef.current || shouldPlay.current;
    try { await playback.refreshOnce(); } catch { recovering.current = false; setPlaying(false); playingRef.current = false; }
  }, [playback.refreshOnce]);
  const start = async () => { try { const element = media.current; if (playing) { element?.pause(); return; } if (playback.access && element && !isExpired(playback.access.expiresAt)) { await element.play(); return; } shouldPlay.current = true; await playback.request(); } catch { shouldPlay.current = false; setPlaying(false); playingRef.current = false; } };
  const loaded = () => { const element = media.current; if (!element) return; const loadedDuration = Number.isFinite(element.duration) ? element.duration : 0; setDuration(loadedDuration); if (resumeAt.current > 0) element.currentTime = Math.min(resumeAt.current, loadedDuration || resumeAt.current); recovering.current = false; if (shouldPlay.current) { shouldPlay.current = false; void element.play().catch(() => void recover()); } };
  const seek = (value: number) => { const seconds = value / 1000; currentRef.current = seconds; setCurrent(seconds); if (media.current) media.current.currentTime = seconds; };
  const beginInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    interactionPointer.current = event.button === 0 ? { x: event.clientX, y: event.clientY, wasSelected: props.selected } : null;
  }, [props.selected]);
  const endInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = interactionPointer.current;
    interactionPointer.current = null;
    if (!pointer || !pointer.wasSelected || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) return;
    setInteracting(true);
  }, []);
  const durationMs = Math.max(0, Math.round(duration * 1000)); const currentMs = Math.min(durationMs, Math.max(0, Math.round(current * 1000)));
  return <NodeShell {...props}><div className="dw-audio-node"><CanvasNodeTitle className="dw-audio-node__title" data-drag-handle kind="audio" title={item.title}/><div className="dw-audio-node__surface" data-drag-handle style={getCanvasNodeFrameStyle({ selected: props.selected, dragging: props.dragging })}>{item.sceneLabel && <p className="dw-audio-node__scene">{item.sceneLabel}</p>}<div className="dw-waveform nodrag nopan nowheel">{item.waveform.map((value, i) => <i key={i} style={{ height: `${Math.max(4, value * 112)}px` }} />)}{playback.access && <audio ref={media} src={playback.access.url} preload="metadata" onLoadedMetadata={loaded} onPlay={() => { playingRef.current = true; setPlaying(true); }} onPause={() => { playingRef.current = false; setPlaying(false); }} onEnded={() => { playingRef.current = false; currentRef.current = 0; setPlaying(false); setCurrent(0); }} onError={() => void recover()} onTimeUpdate={() => { const value = media.current?.currentTime ?? 0; currentRef.current = value; setCurrent(value); }} />}</div><div className="dw-media-controls dw-audio-node__controls nodrag nopan nowheel"><button className="nodrag nopan nowheel" type="button" aria-label={playing ? '暂停音频' : '播放音频'} onClick={() => void start()}>{playing ? '❚❚' : '▶'}</button><span>{formatDuration(currentMs)}</span><input className="nodrag nopan nowheel" aria-label="音频进度" type="range" min="0" max={durationMs} value={currentMs} disabled={durationMs === 0} onInput={(event) => seek(Number(event.currentTarget.value))} /><span>{formatDuration(durationMs)}</span></div>{playback.errorMessage && <Empty>{playback.errorMessage}</Empty>}{!interacting && <div className="dw-audio-node__interaction-overlay" data-drag-handle aria-label="选择或拖拽音频节点" onPointerDown={beginInteractionPointer} onPointerUp={endInteractionPointer} />}</div></div></NodeShell>;
}
export function VideoNode(props: Props) {
  const item = props.data.item; if (item.kind !== 'video') return null;
  const preview = useAssetUrl(item.assetId, true); const playback = useMediaPlayback(item.assetId); const media = useRef<HTMLVideoElement>(null);
  const shouldPlay = useRef(false); const recovering = useRef(false); const resumeAt = useRef(0); const currentRef = useRef(0); const playingRef = useRef(false);
  const overlayPointer = useRef<{ x: number; y: number; wasSelected: boolean } | null>(null);
  const [playing, setPlaying] = useState(false); const [current, setCurrent] = useState(0); const [duration, setDuration] = useState(item.durationMs / 1000); const [interactive, setInteractive] = useState(false);
  useEffect(() => { setDuration(item.durationMs / 1000); setCurrent(0); currentRef.current = 0; setPlaying(false); playingRef.current = false; shouldPlay.current = false; resumeAt.current = 0; recovering.current = false; setInteractive(false); }, [item.assetId, item.durationMs]);
  useEffect(() => {
    if (props.selected) return;
    shouldPlay.current = false;
    recovering.current = false;
    media.current?.pause();
    playingRef.current = false;
    setPlaying(false);
    setInteractive(false);
  }, [props.selected]);
  const recover = useCallback(async () => {
    if (recovering.current) return;
    recovering.current = true; resumeAt.current = media.current?.currentTime ?? currentRef.current; shouldPlay.current = playingRef.current || shouldPlay.current;
    try { await playback.refreshOnce(); } catch { recovering.current = false; setPlaying(false); playingRef.current = false; }
  }, [playback.refreshOnce]);
  const start = async () => { try { const element = media.current; if (playing) { element?.pause(); return; } if (playback.access && element && !isExpired(playback.access.expiresAt)) { await element.play(); return; } shouldPlay.current = true; await playback.request(); } catch { shouldPlay.current = false; setPlaying(false); playingRef.current = false; } };
  const loaded = () => { const element = media.current; if (!element) return; const loadedDuration = Number.isFinite(element.duration) ? element.duration : 0; setDuration(loadedDuration); if (resumeAt.current > 0) element.currentTime = Math.min(resumeAt.current, loadedDuration || resumeAt.current); recovering.current = false; if (shouldPlay.current) { shouldPlay.current = false; void element.play().catch(() => void recover()); } };
  const seek = (value: number) => { const seconds = value / 1000; currentRef.current = seconds; setCurrent(seconds); if (media.current) media.current.currentTime = seconds; };
  const beginInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    overlayPointer.current = event.button === 0 ? { x: event.clientX, y: event.clientY, wasSelected: props.selected } : null;
  }, [props.selected]);
  const endInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = overlayPointer.current;
    overlayPointer.current = null;
    if (!pointer || !pointer.wasSelected || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) return;
    setInteractive(true);
  }, []);
  const durationMs = Math.max(0, Math.round(duration * 1000)); const currentMs = Math.min(durationMs, Math.max(0, Math.round(current * 1000)));
  return <NodeShell {...props}>
    <div className="dw-video-node">
      <CanvasNodeTitle className="dw-video-node__title" data-drag-handle kind="video" title={item.title}/>
      <div className="dw-video-node__surface" data-drag-handle style={getCanvasNodeFrameStyle({ selected: props.selected, dragging: props.dragging })}>
        <div className="dw-video-poster nodrag nopan nowheel">{playback.access ? <video className="nodrag nopan nowheel" ref={media} src={playback.access.url} preload="metadata" playsInline controls={false} onLoadedMetadata={loaded} onPlay={() => { playingRef.current = true; setPlaying(true); }} onPause={() => { playingRef.current = false; setPlaying(false); }} onEnded={() => { playingRef.current = false; currentRef.current = 0; setPlaying(false); setCurrent(0); }} onError={() => void recover()} onTimeUpdate={() => { const value = media.current?.currentTime ?? 0; currentRef.current = value; setCurrent(value); }} /> : preview.url ? <img draggable={false} src={preview.url} alt="" /> : <Empty /> }<button className="nodrag nopan nowheel" type="button" aria-label={playing ? '暂停视频' : '播放视频'} onClick={() => void start()}>{playing ? '❚❚' : '▶'}</button></div>
        <div className="dw-media-controls dw-video-node__controls nodrag nopan nowheel"><span>{formatDuration(currentMs)}</span><input className="nodrag nopan nowheel" aria-label="视频进度" type="range" min="0" max={durationMs} value={currentMs} disabled={durationMs === 0} onInput={(event) => { const next = Number(event.currentTarget.value); currentRef.current = next / 1000; setCurrent(next / 1000); }} onPointerUp={(event) => seek(Number(event.currentTarget.value))} onKeyUp={(event) => seek(Number(event.currentTarget.value))} /><span>{formatDuration(durationMs)}</span></div>
        {playback.errorMessage && <Empty>{playback.errorMessage}</Empty>}
        {!interactive && <div className="dw-video-node__interaction-overlay" data-drag-handle aria-label="选择或拖拽视频节点" onPointerDown={beginInteractionPointer} onPointerUp={endInteractionPointer} />}
      </div>
    </div>
  </NodeShell>;
}
export function WebPreviewNode(props: Props) {
  const item = props.data.item;
  if (item.kind !== 'web-preview') return null;
  return <NodeShell {...props}><ResourceNodeFrame item={item} selected={props.selected} dragging={props.dragging}><iframe className="dw-web-preview-frame nowheel" title={item.title} src={item.url} sandbox="allow-scripts" referrerPolicy="no-referrer" /></ResourceNodeFrame></NodeShell>;
}
export function PdfNode(props: Props) {
  const item = props.data.item;
  if (item.kind !== 'pdf') return null;
  return <OnlyOfficeViewerNode props={props} item={item} />;
}
export function FrameNode(props: Props) {
  const item = props.data.item;
  const documentService = useService(ICanvasDocumentService);
  const history = useService(ICanvasHistoryService);
  const interaction = useService(ICanvasInteractionService);
  const events = useService(ICanvasEventService);
  const runtime = useCreativeNodeRuntime();
  const flow = useReactFlow<FlowNode>();
  const [interactionSnapshot, setInteractionSnapshot] = useState(() => interaction.getSnapshot());
  const [isRenaming, setIsRenaming] = useState(false);
  const [title, setTitle] = useState(item.kind === 'frame' ? item.title : '');
  const [busyActionId, setBusyActionId] = useState<NodeToolbarActionId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (item.kind !== 'frame') return null;

  const actions = runtime.toolbar?.getActions(item) ?? [];
  const showActions = props.selected && !props.dragging && interactionSnapshot.toolMode === 'pointer' && interactionSnapshot.selectedItemIds.length === 1;

  useEffect(() => interaction.onDidChange.subscribe(setInteractionSnapshot).dispose, [interaction]);

  useEffect(() => {
    if (!isRenaming) setTitle(item.title);
  }, [isRenaming, item.title]);
  useEffect(() => {
    if (!isRenaming) return;
    input.current?.focus();
    input.current?.select();
  }, [isRenaming]);

  const cancelRename = () => {
    setTitle(item.title);
    setIsRenaming(false);
  };
  const saveRename = () => {
    const nextTitle = title.trim();
    setIsRenaming(false);
    if (!nextTitle || nextTitle === item.title) {
      setTitle(item.title);
      return;
    }
    const updatedAt = new Date().toISOString();
    history.execute({
      id: crypto.randomUUID(),
      projectId: documentService.getDocument().projectId,
      createdAt: updatedAt,
      actor: 'user',
      type: 'update-item',
      item: { ...item, title: nextTitle, updatedAt },
    });
  };
  const executeToolbarAction = async (actionId: NodeToolbarActionId) => {
    if (busyActionId) return;
    setBusyActionId(actionId);
    setActionError(null);
    try {
      const createdItemId = await runtime.toolbar?.execute(actionId, item.id);
      if (createdItemId) events.request({ type: 'select-items', itemIds: [createdItemId] });
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请重试。';
      setActionError(message);
      runtime.onToast?.(message);
    } finally {
      setBusyActionId(null);
    }
  };
  const beginTitleDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const frameElement = [...window.document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .find((node) => node.dataset.id === item.id);
    const titleElement = event.currentTarget.closest<HTMLElement>('.react-flow__node-toolbar');
    const document = documentService.getDocument();
    const frame = document.placements.get(item.id);
    if (!frameElement || !titleElement || !frame) return;

    // The title lives outside the Frame's rectangle, so React Flow cannot
    // start a native node drag from it. Move the same persisted placement
    // set here, including every node fully enclosed by the Frame.
    const start = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const originalTransform = frameElement.style.transform;
    const originalTitleTransform = titleElement.style.transform;
    const children = [...document.placements.values()].filter((placement) => (
      placement.itemId !== item.id
      && placement.x >= frame.x
      && placement.y >= frame.y
      && placement.x + placement.width <= frame.x + frame.width
      && placement.y + placement.height <= frame.y + frame.height
    ));

    interaction.setSelectedItemIds([item.id]);
    const move = (moveEvent: PointerEvent) => {
      const point = flow.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      frameElement.style.transform = `${originalTransform} translate(${point.x - start.x}px, ${point.y - start.y}px)`;
      titleElement.style.transform = `${originalTitleTransform} translate(${moveEvent.clientX - event.clientX}px, ${moveEvent.clientY - event.clientY}px)`;
    };
    const stop = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
      frameElement.style.transform = originalTransform;
      titleElement.style.transform = originalTitleTransform;

      const point = flow.screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
      const offset = { x: point.x - start.x, y: point.y - start.y };
      if (offset.x === 0 && offset.y === 0) return;
      history.execute({
        id: crypto.randomUUID(),
        projectId: document.projectId,
        createdAt: new Date().toISOString(),
        actor: 'user',
        type: 'set-placements',
        placements: [
          { ...frame, x: frame.x + offset.x, y: frame.y + offset.y },
          ...children.map((placement) => ({ ...placement, x: placement.x + offset.x, y: placement.y + offset.y })),
        ],
      });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', stop, true);
    event.preventDefault();
    event.stopPropagation();
  };
  return <>
    {showActions && actions.length > 0 && <NodeToolbar nodeId={item.id} isVisible position={Position.Top} offset={26} className="dw-node-toolbar-portal"><CanvasNodeHoverToolbarView actions={actions} busyActionId={busyActionId} onAction={(action) => void executeToolbarAction(action.id)} /></NodeToolbar>}
    <NodeToolbar nodeId={item.id} isVisible position={Position.Top} offset={6} align="start" className="dw-frame-node__toolbar" style={{ zIndex: 1000 }}>
      <div className="dw-frame-node__label" data-drag-handle>
      {isRenaming ? <><CanvasNodeTypeIcon kind="frame" /><input ref={input} className="dw-frame-node__title-input nodrag nopan nowheel" aria-label="重命名画框" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveRename} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRename(); } else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} /></> : <CanvasNodeTitle role="button" tabIndex={0} className="dw-frame-node__title nowheel" data-drag-handle aria-label="重命名画框" kind="frame" title={item.title} onPointerDownCapture={beginTitleDrag} onDoubleClick={(event) => { event.stopPropagation(); setIsRenaming(true); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setIsRenaming(true); } }} />}
      </div>
    </NodeToolbar>
    {actionError && <div role="alert" style={{ position: 'absolute', right: 16, bottom: 12, zIndex: 30, borderRadius: 6, background: '#152238', color: '#fff', padding: '5px 8px', fontSize: 12 }}>{actionError}</div>}
    <div className={`dw-frame-node${props.selected ? ' is-selected' : ''}${props.dragging ? ' is-dragging' : ''}`} data-drag-handle />
  </>;
}

export function HtmlViewerNode(props: Props) {
  const item = props.data.item;
  if (item.kind !== 'html') return null;
  const access = useAssetUrl(item.assetId, item.previewAvailable, true);
  const url = access.url?.trim() ?? '';
  if (!url) {
    return <NodeShell {...props}><ResourceNodeFrame item={item} selected={props.selected} dragging={props.dragging}><div className="dw-html-viewer__fallback nowheel"><span className="dw-html-viewer__icon" aria-hidden="true">&lt;/&gt;</span><strong>{item.title}</strong></div></ResourceNodeFrame></NodeShell>;
  }
  return <NodeShell {...props}><ResourceNodeFrame item={item} selected={props.selected} dragging={props.dragging}><div className="dw-html-viewer"><HtmlPreviewFrame title={item.title} url={url}/><span className="sr-only">HTML</span></div></ResourceNodeFrame></NodeShell>;
}

/**
 * The renderer injects a runtime into the processed HTML artifact. The only
 * control channel is a fresh MessagePort, scoped to this iframe navigation.
 */
function HtmlPreviewFrame({ title, url }: { title: string; url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    const element = frame.current;
    const targetOrigin = httpOrigin(url);
    if (!element || !targetOrigin) return;
    const loadGeneration = ++generation.current;
    const sessionId = crypto.randomUUID();
    let channel: MessageChannel | null = null;
    const configure = () => {
      channel?.port1.close();
      channel = new MessageChannel();
      channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
        const message = event.data as { type?: string; sessionId?: string; loadGeneration?: number };
        if (message.sessionId !== sessionId || message.loadGeneration !== loadGeneration) return;
        if (message.type !== 'dream-weave:html-preview:ready' && message.type !== 'dream-weave:html-preview:error') return;
      });
      channel.port1.start();
      element.contentWindow?.postMessage({ type: 'dream-weave:html-preview:configure', protocolVersion: 1, sessionId, loadGeneration }, targetOrigin, [channel.port2]);
    };
    element.addEventListener('load', configure);
    return () => { element.removeEventListener('load', configure); channel?.port1.close(); };
  }, [url]);
  return <iframe ref={frame} title={title} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="pointer-events-none dw-html-viewer__frame" />;
}

export function OfficeNode(props: Props) {
  const item = props.data.item;
  if (item.kind !== 'office') return null;
  return <OnlyOfficeViewerNode props={props} item={item} />;
}

function OnlyOfficeViewerNode({ props, item }: { props: Props; item: Extract<CanvasItem, { kind: 'pdf' | 'office' }> }) {
  const { office } = useCreativeNodeRuntime();
  const [session, setSession] = useState<OfficeViewerSessionRuntimeConfig | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(item.previewAvailable ? 'loading' : 'error');
  const frame = useRef<HTMLIFrameElement>(null);
  const overlayPointer = useRef<{ x: number; y: number; wasSelected: boolean } | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    let active = true;
    setSession(null);
    setState(item.previewAvailable && office ? 'loading' : 'error');
    setInteractive(false);
    if (!item.previewAvailable || !office) return () => { active = false; };
    void office.getSession(item.assetId).then((value) => { if (active) setSession(value); }, () => { if (active) setState('error'); });
    return () => { active = false; };
  }, [item.assetId, item.previewAvailable, office]);
  useEffect(() => { if (!props.selected) setInteractive(false); }, [props.selected]);
  const shell = session ? officeShellUrl(session) : null;
  const shellOrigin = session ? officeShellOrigin(session) : null;
  const documentLabel = item.kind === 'pdf' ? 'PDF' : 'Office';
  useLayoutEffect(() => {
    if (!session || !shellOrigin) return;
    const receivePreviewState = (event: MessageEvent<unknown>) => {
      if (event.origin !== shellOrigin || event.source !== frame.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as { type?: unknown; sessionId?: unknown };
      if (message.sessionId !== session.sessionId) return;
      if (message.type === 'dream-weave:office-preview-ready') setState('ready');
      if (message.type === 'dream-weave:office-preview-error') setState('error');
    };
    window.addEventListener('message', receivePreviewState);
    return () => window.removeEventListener('message', receivePreviewState);
  }, [session, shellOrigin]);
  const beginInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    overlayPointer.current = event.button === 0 ? { x: event.clientX, y: event.clientY, wasSelected: props.selected } : null;
  }, [props.selected]);
  const endInteractionPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = overlayPointer.current;
    overlayPointer.current = null;
    if (!pointer || !pointer.wasSelected || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) return;
    setInteractive(true);
  }, []);
  return <NodeShell {...props}><ResourceNodeFrame item={item} selected={props.selected} dragging={props.dragging}>{shell && state !== 'error' ? <><iframe ref={frame} className={`dw-onlyoffice-frame nodrag nopan${state === 'ready' ? ' dw-onlyoffice-frame--ready' : ''}${interactive ? ' dw-onlyoffice-frame--interactive' : ''}`} title={`${item.title} ${documentLabel} 预览`} src={shell} sandbox="allow-scripts allow-same-origin" aria-hidden={!interactive} onError={() => setState('error')} />{!interactive && <div className="dw-onlyoffice-frame__interaction-overlay" data-drag-handle aria-label={`选择或拖拽${documentLabel}节点`} onPointerDown={beginInteractionPointer} onPointerUp={endInteractionPointer} />}</> : state === 'loading' ? <DocumentPreviewLoading /> : <Empty>{`${documentLabel} 预览不可用`}</Empty>}</ResourceNodeFrame></NodeShell>;
}

// Local animated arc loader that avoids a cross-workspace UI dependency.
function DocumentPreviewLoading() {
  return <div className="dw-document-preview-loading" role="status" aria-label="正在加载预览"><svg className="dw-document-preview-loading__spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle className="dw-document-preview-loading__track" cx="12" cy="12" r="10" /><circle className="dw-document-preview-loading__arc dw-document-preview-loading__arc--one" cx="12" cy="12" r="10" /><circle className="dw-document-preview-loading__arc dw-document-preview-loading__arc--two" cx="12" cy="12" r="10" /></svg><span>正在加载预览</span></div>;
}
function officeShellOrigin(session: OfficeViewerSessionRuntimeConfig): string | null { try { const origin = new URL(session.documentServerUrl); return origin.protocol === 'https:' ? origin.origin : null; } catch { return null; } }
function officeShellUrl(session: OfficeViewerSessionRuntimeConfig): string | null { const origin = officeShellOrigin(session); return origin ? `${origin}/dw-viewer-shell/${encodeURIComponent(session.sessionId)}` : null; }
function httpOrigin(value: string): string | null { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null; } catch { return null; } }
function isHttpStatus(error: unknown, status: number): boolean { return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === status; }
function formatDuration(value: number): string { const seconds = Math.floor(value / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
