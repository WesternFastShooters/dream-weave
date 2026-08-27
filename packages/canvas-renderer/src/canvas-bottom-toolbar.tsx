import { type ICanvasAssetUploadService } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService } from '@dream-weave/canvas-interaction';
import { useService } from '@dream-weave/di';
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent, type ReactElement } from 'react';

export interface CanvasBottomToolbarProps {
  readonly assetUpload?: ICanvasAssetUploadService;
  readonly onBeginMarkdownPlacement?: () => void;
  readonly onBeginWebPreviewPlacement?: () => void;
  readonly onBeginFrameDrawing?: () => void;
  /** Chooses the selection-region geometry while retaining the pointer tool's behavior. */
  readonly lassoShape?: 'rectangle' | 'line';
  readonly onLassoShapeChange?: (shape: 'rectangle' | 'line') => void;
}

type LassoToolMode = 'pointer' | 'freeform-lasso';

// Keep this in sync with the client markdown importer and server-side asset detector.
// The server remains authoritative because drag-and-drop can bypass this chooser filter.
const UPLOAD_FILE_ACCEPT = '.md,.markdown,.txt,.text,.apng,.avif,.bmp,.gif,.heic,.heif,.jpg,.jpeg,.png,.svg,.webp,.aac,.aif,.aiff,.flac,.m4a,.mp3,.ogg,.opus,.wav,.weba,.avi,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.ogv,.webm,.html,.htm,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

/** Product-neutral bottom overlay: it forwards opaque Files and changes only the existing tool mode. */
export function CanvasBottomToolbar({ assetUpload, onBeginMarkdownPlacement, onBeginWebPreviewPlacement, onBeginFrameDrawing, lassoShape = 'rectangle', onLassoShapeChange }: CanvasBottomToolbarProps): ReactElement {
  const interaction = useService(ICanvasInteractionService);
  const events = useService(ICanvasEventService);
  const input = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState(() => assetUpload?.getSnapshot() ?? { phase: 'idle' as const, errorMessage: null });
  const [toolMode, setToolMode] = useState(() => interaction.getSnapshot().toolMode);
  const [lassoMenuOpen, setLassoMenuOpen] = useState(false);
  const selectedLassoToolMode: LassoToolMode = lassoShape === 'line' ? 'freeform-lasso' : 'pointer';
  useEffect(() => interaction.onDidChange.subscribe((next) => setToolMode(next.toolMode)).dispose, [interaction]);
  useEffect(() => assetUpload?.onDidChange.subscribe(setSnapshot).dispose, [assetUpload]);
  useEffect(() => {
    if (!lassoMenuOpen) return;
    const dismissOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) setLassoMenuOpen(false);
    };
    const dismissOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLassoMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismissOnPointerDown, true);
    document.addEventListener('keydown', dismissOnKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown, true);
      document.removeEventListener('keydown', dismissOnKeyDown);
    };
  }, [lassoMenuOpen]);
  const stop = (event: PointerEvent<HTMLElement>) => event.stopPropagation();
  const choose = () => { if (assetUpload) input.current?.click(); };
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...event.currentTarget.files ?? []];
    event.currentTarget.value = '';
    if (files.length > 0 && assetUpload) void assetUpload.upload(files);
  };
  const setTool = (toolMode: 'pointer' | 'hand' | 'freeform-lasso' | 'connection') => {
    events.request({ type: 'set-tool-mode', toolMode });
    setLassoMenuOpen(false);
  };
  const chooseLassoTool = (nextToolMode: LassoToolMode) => {
    onLassoShapeChange?.(nextToolMode === 'freeform-lasso' ? 'line' : 'rectangle');
    setTool('pointer');
  };
  return <div ref={toolbar} className="dw-bottom-toolbar nodrag nopan nowheel" role="toolbar" aria-label="画布工具" onPointerDown={stop}>
    <input ref={input} className="dw-bottom-toolbar__input" type="file" accept={UPLOAD_FILE_ACCEPT} multiple onChange={change} tabIndex={-1} aria-hidden="true" />
    <button className={`dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel ${toolMode === 'hand' ? 'is-active' : ''}`} type="button" aria-label="手形工具" data-tooltip="手形工具 H" aria-pressed={toolMode === 'hand'} onPointerDown={stop} onClick={() => setTool('hand')}><HandIcon /></button>
    <div className="dw-bottom-toolbar__tool-group">
      <button className={`dw-bottom-toolbar__button dw-bottom-toolbar__button--main nodrag nopan nowheel ${toolMode === 'pointer' ? 'is-active' : ''}`} type="button" aria-label={selectedLassoToolMode === 'pointer' ? '矩形套索' : '线条套索'} data-tooltip={selectedLassoToolMode === 'pointer' ? '矩形套索 V' : '线条套索 V'} aria-pressed={toolMode === 'pointer'} onPointerDown={stop} onClick={() => setTool('pointer')}><PointerIcon /></button>
      <button className="dw-bottom-toolbar__chevron nodrag nopan nowheel" type="button" aria-label="选择套索工具" data-tooltip="选择套索工具" aria-expanded={lassoMenuOpen} onPointerDown={stop} onClick={() => setLassoMenuOpen((open) => !open)}><ChevronIcon open={lassoMenuOpen} /></button>
      {lassoMenuOpen && <div className="dw-bottom-toolbar__menu nodrag nopan nowheel" role="menu" onPointerDown={stop}>
        <button type="button" role="menuitemradio" aria-checked={selectedLassoToolMode === 'pointer'} onClick={() => chooseLassoTool('pointer')}><CheckIcon visible={selectedLassoToolMode === 'pointer'} /><RectangleLassoIcon /><span>矩形套索</span></button>
        <button type="button" role="menuitemradio" aria-checked={selectedLassoToolMode === 'freeform-lasso'} onClick={() => chooseLassoTool('freeform-lasso')}><CheckIcon visible={selectedLassoToolMode === 'freeform-lasso'} /><LineLassoIcon /><span>线条套索</span></button>
      </div>}
    </div>
    <button className="dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel" type="button" aria-label="添加文本" data-tooltip="添加文本 T" onPointerDown={stop} onClick={onBeginMarkdownPlacement}><TextDocumentIcon /></button>
    <button className="dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel" type="button" aria-label="添加网页预览" data-tooltip="添加网页预览 W" onPointerDown={stop} onClick={onBeginWebPreviewPlacement}><WebIcon /></button>
    <button className="dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel" type="button" aria-label="画框工具" data-tooltip="画框工具 F" onPointerDown={stop} onClick={onBeginFrameDrawing}><FrameIcon /></button>
    <button className={`dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel ${toolMode === 'connection' ? 'is-active' : ''}`} type="button" aria-label="连线工具" data-tooltip="连线工具 C" aria-pressed={toolMode === 'connection'} onPointerDown={stop} onClick={() => setTool('connection')}><ConnectionIcon /></button>
    <button className="dw-bottom-toolbar__button dw-bottom-toolbar__button--standalone nodrag nopan nowheel" type="button" aria-label="添加文件" data-tooltip="添加文件" aria-busy={snapshot.phase === 'uploading'} disabled={!assetUpload || snapshot.phase === 'uploading'} onPointerDown={stop} onClick={choose}>{snapshot.phase === 'uploading' ? '…' : <CirclePlusIcon />}</button>
    {snapshot.phase === 'failed' && <span className="dw-bottom-toolbar__error" role="status">{snapshot.errorMessage}</span>}
  </div>;
}

function CirclePlusIcon(): ReactElement { return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>; }
function ConnectionIcon(): ReactElement { return <svg className="dw-bottom-toolbar__connection-icon" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M993.92 798.08l-128-128c-18.56-18.56-49.28-18.56-67.84 0s-18.56 49.28 0 67.84l46.08 46.08H288c-61.44 0-112-50.56-112-112s50.56-112 112-112h448c114.56 0 208-93.44 208-208s-93.44-208-208-208H360.32C339.2 70.4 272 16 192 16 94.72 16 16 94.72 16 192S94.72 368 192 368c80 0 147.2-54.4 168.32-128h375.68c61.44 0 112 50.56 112 112s-50.56 112-112 112h-448c-114.56 0-208 93.44-208 208s93.44 208 208 208h556.16l-46.08 46.08c-18.56 18.56-18.56 49.28 0 67.84 9.6 9.6 21.76 14.08 33.92 14.08s24.32-4.48 33.92-14.08l128-128c18.56-18.56 18.56-49.28 0-67.84zM192 272a80 80 0 1 1 0-160 80 80 0 0 1 0 160z" /></svg>; }
function TextDocumentIcon(): ReactElement { return <svg className="dw-bottom-toolbar__text-document-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14.04 1.001a3.4 3.4 0 0 1 2.371.998l3.586 3.586.116.121A3.4 3.4 0 0 1 21 8v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8zM6 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9h-4a2 2 0 0 1-2-2V3zm10 13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm0-4a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm-6-4a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm5-1h3.584L15 3.416z" /></svg>; }
function FrameIcon(): ReactElement {
  return <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><g strokeWidth="1.5"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M4 7l16 0" /><path d="M4 17l16 0" /><path d="M7 4l0 16" /><path d="M17 4l0 16" /></g></svg>;
}
function WebIcon(): ReactElement { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>; }
function PointerIcon(): ReactElement { return <svg className="dw-bottom-toolbar__pointer-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4.037 4.688a.495.495 0 0 1 .65-.651l16 6.5a.5.5 0 0 1-.062.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.58 6.126a.5.5 0 0 1-.946.063z" /></svg>; }
function RectangleLassoIcon(): ReactElement { return <svg className="dw-bottom-toolbar__lasso-icon" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M900.48 276.48c22.912 0 41.344-18.432 41.344-41.344v-101.632c0-22.912-18.432-41.344-41.344-41.344h-101.376c-22.912 0-41.344 18.432-41.344 41.344V152.32H266.24v-18.816c0-22.912-18.432-41.344-41.344-41.344H123.264C100.48 92.16 81.92 110.72 81.92 133.504v101.376c0 22.912 18.432 41.344 41.344 41.344H142.08V768H123.264C100.48 768 81.92 786.432 81.92 809.344v101.376c0 22.912 18.432 41.344 41.344 41.344h101.632c22.912 0 41.344-18.432 41.344-41.344V892.16h491.52v18.816c0 22.912 18.432 41.344 41.344 41.344h101.376c22.912 0 41.344-18.432 41.344-41.344v-101.632c0-22.912-18.432-41.344-41.344-41.344H881.92V276.48h18.56z m-81.92-123.392h62.208v62.464h-62.208v-62.464z m-675.712 0.128h62.464v62.208h-62.464v-62.208z m62.464 737.92h-62.464v-62.208h62.464v62.208z m675.456 0.128h-62.208v-62.464h62.208v62.464zM817.92 768h-18.816c-22.912 0-41.344 18.432-41.344 41.344V828.16H266.24v-18.816c0-22.912-18.432-41.344-41.344-41.344H206.08V276.224h18.816c22.912 0 41.344-18.432 41.344-41.344V216.32h491.52v18.816c0 22.912 18.432 41.344 41.344 41.344H817.92v491.52z" /></svg>; }
function LineLassoIcon(): ReactElement { return <svg className="dw-bottom-toolbar__lasso-icon" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M993.28 225.28C936.96 46.08 675.84-35.84 409.6 51.2 143.36 133.12-25.6 353.28 30.72 532.48c5.12 15.36 10.24 30.72 20.48 46.08-35.84 51.2-46.08 107.52-25.6 153.6 35.84 87.04 174.08 112.64 302.08 56.32 5.12 0 10.24-5.12 15.36-10.24 5.12 10.24 15.36 15.36 15.36 25.6 10.24 10.24 10.24 20.48 10.24 20.48-5.12 15.36-25.6 35.84-40.96 56.32-20.48 20.48-35.84 40.96-51.2 56.32l71.68 71.68c15.36-15.36 35.84-35.84 56.32-61.44 20.48-25.6 40.96-51.2 56.32-81.92 20.48-46.08 5.12-92.16-15.36-122.88l-5.12-5.12c56.32-5.12 117.76-15.36 174.08-30.72 271.36-81.92 440.32-296.96 378.88-481.28zM184.32 716.8c-30.72-5.12-40.96-20.48-40.96-20.48 0-5.12-5.12-15.36 5.12-35.84 30.72 20.48 66.56 40.96 107.52 56.32H184.32z m220.16-97.28c-5.12 5.12-10.24 15.36-15.36 20.48-30.72 0-61.44-10.24-92.16-15.36-30.72-10.24-56.32-20.48-81.92-35.84l30.72-15.36c46.08-20.48 92.16-25.6 122.88-20.48 30.72 5.12 40.96 20.48 40.96 20.48 5.12 0 10.24 15.36-5.12 46.08z m460.8-179.2c-56.32 66.56-143.36 133.12-261.12 168.96-30.72 10.24-66.56 20.48-97.28 20.48 10.24-35.84 15.36-71.68 0-102.4-35.84-81.92-168.96-107.52-296.96-51.2-20.48 5.12-40.96 15.36-56.32 30.72v-5.12c-15.36-51.2-5.12-112.64 51.2-184.32 51.2-71.68 138.24-133.12 256-168.96 117.76-35.84 225.28-35.84 312.32-10.24 81.92 25.6 133.12 71.68 148.48 122.88 10.24 46.08 0 112.64-56.32 179.2z" /></svg>; }
function HandIcon(): ReactElement { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 11V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.4 6.5-6 6.5-2.1 0-3.6-1-4.7-2.7L4 13.5a1.6 1.6 0 0 1 2.6-1.8L8 14" /></svg>; }
function ChevronIcon({ open }: { open: boolean }): ReactElement { return <svg aria-hidden="true" className={open ? 'is-expanded' : 'is-collapsed'} viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>; }
function CheckIcon({ visible }: { visible: boolean }): ReactElement { return <span className="dw-bottom-toolbar__check" aria-hidden>{visible ? '✓' : ''}</span>; }
