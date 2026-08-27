import { ICanvasDocumentService, ICanvasHistoryService, MARKDOWN_NODE_RESIZE_BOUNDS, type CanvasDocument } from '@dream-weave/canvas-core';
import { ICanvasEventService, ICanvasInteractionService } from '@dream-weave/canvas-interaction';
import { useService } from '@dream-weave/di';
import { editorViewCtx } from '@milkdown/core';
import { Crepe } from '@milkdown/crepe';
import { TextSelection } from '@milkdown/prose/state';
import { replaceAll } from '@milkdown/utils';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCreativeNodeRuntime } from './creative-node-context.js';

type DrawerPanel = { kind: 'markdown'; itemId: string } | null;
type CanvasSideDrawerApi = {
  openMarkdown(itemId: string): void;
  markdownDrafts: ReadonlyMap<string, string>;
  publishMarkdownDraft(itemId: string, markdown: string): void;
  clearMarkdownDraft(itemId: string): void;
};

const CanvasSideDrawerContext = createContext<CanvasSideDrawerApi>({
  openMarkdown: () => undefined,
  markdownDrafts: new Map(),
  publishMarkdownDraft: () => undefined,
  clearMarkdownDraft: () => undefined,
});

/**
 * Canvas-level panel host. New panel kinds (for example an agent conversation)
 * belong in `DrawerPanel`; node renderers only request the panel they need.
 */
export function CanvasSideDrawerProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<DrawerPanel>(null);
  const [markdownDrafts, setMarkdownDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const openMarkdown = useCallback((itemId: string) => setPanel({ kind: 'markdown', itemId }), []);
  const close = useCallback(() => setPanel(null), []);
  const publishMarkdownDraft = useCallback((itemId: string, markdown: string) => setMarkdownDrafts((current) => {
    if (current.get(itemId) === markdown) return current;
    const next = new Map(current);
    next.set(itemId, markdown);
    return next;
  }), []);
  const clearMarkdownDraft = useCallback((itemId: string) => setMarkdownDrafts((current) => {
    if (!current.has(itemId)) return current;
    const next = new Map(current);
    next.delete(itemId);
    return next;
  }), []);
  const value = useMemo(() => ({ openMarkdown, markdownDrafts, publishMarkdownDraft, clearMarkdownDraft }), [clearMarkdownDraft, markdownDrafts, openMarkdown, publishMarkdownDraft]);

  return <CanvasSideDrawerContext.Provider value={value}>
    {children}
    {panel?.kind === 'markdown' && <MarkdownDrawer key={panel.itemId} itemId={panel.itemId} onClose={close} />}
  </CanvasSideDrawerContext.Provider>;
}

export function useCanvasSideDrawer(): CanvasSideDrawerApi { return useContext(CanvasSideDrawerContext); }

function MarkdownDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const documentService = useService(ICanvasDocumentService);
  const history = useService(ICanvasHistoryService);
  const interaction = useService(ICanvasInteractionService);
  const events = useService(ICanvasEventService);
  const drawer = useCanvasSideDrawer();
  const runtime = useCreativeNodeRuntime();
  const [document, setDocument] = useState<CanvasDocument>(() => documentService.getDocument());
  const draftRef = useRef('');
  const persistedRef = useRef('');
  const autoGrowHeight = useRef<number | null>(null);
  const item = document.items.get(itemId);
  const markdown = item?.kind === 'markdown' ? item : null;
  const [drawerWidth, setDrawerWidth] = useState(() => Math.min(600, Math.max(0, window.innerWidth - 16)));
  useEffect(() => {
    const updateWidth = () => setDrawerWidth(Math.min(600, Math.max(0, window.innerWidth - 16)));
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  useEffect(() => {
    events.request({ type: 'set-side-drawer', side: 'right', open: true, width: drawerWidth });
  }, [drawerWidth, events]);
  useEffect(() => () => events.request({ type: 'set-side-drawer', side: 'right', open: false, width: 0 }), [events]);

  useEffect(() => documentService.onDidChange.subscribe(({ document: nextDocument }) => setDocument(nextDocument)).dispose, [documentService]);
  useEffect(() => {
    if (!markdown) onClose();
  }, [markdown, onClose]);
  useEffect(() => {
    if (!markdown) return;
    draftRef.current = markdown.markdown;
    persistedRef.current = markdown.markdown;
  }, [markdown?.id]);

  const persistAutoHeight = useCallback(() => {
    const height = autoGrowHeight.current;
    autoGrowHeight.current = null;
    if (height === null) return;
    const current = documentService.getDocument();
    const placement = current.placements.get(itemId);
    if (!placement || height <= placement.height) return;
    const now = new Date().toISOString();
    history.execute({
      id: crypto.randomUUID(), projectId: current.projectId, createdAt: now, actor: 'user', type: 'set-placements',
      placements: [{ ...placement, height }],
    }, `auto-resize:${placement.itemId}`);
  }, [documentService, history, itemId]);
  const commitAndClose = useCallback(() => {
    const current = documentService.getDocument().items.get(itemId);
    if (current?.kind === 'markdown' && draftRef.current !== persistedRef.current) {
      runtime.markdown?.updateMarkdown(current, draftRef.current);
      persistedRef.current = draftRef.current;
    }
    drawer.clearMarkdownDraft(itemId);
    persistAutoHeight();
    onClose();
  }, [documentService, drawer, itemId, onClose, persistAutoHeight, runtime.markdown]);

  useEffect(() => {
    const syncDrawerWithSelection = ({ selectedItemIds }: ReturnType<typeof interaction.getSnapshot>) => {
      const selectedMarkdownId = selectedItemIds.find((selectedItemId) => documentService.getDocument().items.get(selectedItemId)?.kind === 'markdown');
      if (!selectedMarkdownId) {
        commitAndClose();
        return;
      }
      // The drawer has one editor session, so switching selection must replace
      // that session rather than leaving it attached to the previous node.
      if (selectedMarkdownId !== itemId) {
        const current = documentService.getDocument().items.get(itemId);
        if (current?.kind === 'markdown' && draftRef.current !== persistedRef.current) {
          runtime.markdown?.updateMarkdown(current, draftRef.current);
          persistedRef.current = draftRef.current;
        }
        drawer.clearMarkdownDraft(itemId);
        persistAutoHeight();
        drawer.openMarkdown(selectedMarkdownId);
      }
    };
    syncDrawerWithSelection(interaction.getSnapshot());
    return interaction.onDidChange.subscribe(syncDrawerWithSelection).dispose;
  }, [commitAndClose, documentService, drawer, interaction, itemId, persistAutoHeight, runtime.markdown]);

  const publishDraft = useCallback((nextMarkdown: string) => {
    draftRef.current = nextMarkdown;
    drawer.publishMarkdownDraft(itemId, nextMarkdown);
  }, [drawer, itemId]);
  const resizeForContent = useCallback((contentHeight: number) => {
    const placement = documentService.getDocument().placements.get(itemId);
    if (!placement) return;
    // The drawer's editor column is 552px wide, matching the default text node
    // content width. Preserve its auto-grow contract without an iframe bridge.
    const height = Math.min(MARKDOWN_NODE_RESIZE_BOUNDS.maxHeight, Math.max(MARKDOWN_NODE_RESIZE_BOUNDS.minHeight, Math.ceil(44 + contentHeight)));
    if (height > placement.height) {
      autoGrowHeight.current = Math.max(autoGrowHeight.current ?? placement.height, height);
      interaction.requestNodeResize?.({ itemId, height });
    }
  }, [documentService, interaction, itemId]);

  if (!markdown) return null;
  return <aside className="dw-canvas-side-drawer" data-canvas-side-drawer data-drawer-panel="markdown" aria-label="文本编辑器">
    <header className="dw-canvas-side-drawer__header">
      <span>文本</span>
      <button type="button" aria-label="关闭文本编辑器" onClick={commitAndClose}>×</button>
    </header>
    <div className="dw-canvas-side-drawer__body">
      <MarkdownDrawerEditor key={itemId} markdown={markdown.markdown} onDraft={publishDraft} onContentHeight={resizeForContent} onEscape={commitAndClose} />
    </div>
  </aside>;
}

function MarkdownDrawerEditor({ markdown, onDraft, onContentHeight, onEscape }: { markdown: string; onDraft: (markdown: string) => void; onContentHeight: (height: number) => void; onEscape: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const onDraftRef = useRef(onDraft);
  const onContentHeightRef = useRef(onContentHeight);
  const onEscapeRef = useRef(onEscape);
  onDraftRef.current = onDraft;
  onContentHeightRef.current = onContentHeight;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let disposed = false;
    let observer: MutationObserver | null = null;
    let view: ReturnType<typeof createEditorView> | null = null;
    let pendingResize = false;
    let hydrated = false;
    let edited = false;
    const crepe = new Crepe({
      root: host,
      defaultValue: '',
      features: {
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: { theme: null as never, copyText: '复制代码' },
        [Crepe.Feature.Cursor]: { virtual: false },
        [Crepe.Feature.Placeholder]: { mode: 'doc', text: '输入 Markdown，使用 / 插入块' },
        [Crepe.Feature.BlockEdit]: {
          textGroup: { label: '文本', text: { label: '正文' }, h1: { label: '标题 1' }, h2: { label: '标题 2' }, h3: { label: '标题 3' }, h4: { label: '标题 4' }, h5: { label: '标题 5' }, h6: { label: '标题 6' }, quote: { label: '引用' }, divider: { label: '分割线' } },
          listGroup: { label: '列表', bulletList: { label: '无序列表' }, orderedList: { label: '有序列表' }, taskList: { label: '待办列表' } },
          advancedGroup: { label: '高级', image: { label: '图片' }, codeBlock: { label: '代码块' }, table: { label: '表格' }, math: { label: '公式' } },
        },
      },
    });
    crepe.on((listener) => listener.markdownUpdated((_ctx, nextMarkdown) => {
      if (hydrated) onDraftRef.current(nextMarkdown);
    }));
    const notifyResize = () => {
      // Opening a drawer must not resize its canvas node. Start auto-growing
      // only after an actual editor input, then retain the existing behavior.
      if (!edited) return;
      if (pendingResize) return;
      pendingResize = true;
      requestAnimationFrame(() => {
        pendingResize = false;
        if (view) onContentHeightRef.current(getDocumentFlowHeight(view.dom));
      });
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };
    const handleInput = () => { edited = true; notifyResize(); };
    void crepe.create().then(() => {
      // React StrictMode may clean up the first effect before Crepe finishes
      // creating. Dispose that late instance instead of leaving a second,
      // detached editor in the drawer.
      if (disposed) {
        void crepe.destroy();
        return;
      }
      crepe.editor.action(replaceAll(markdown, true));
      crepe.setReadonly(false);
      view = createEditorView(crepe);
      hydrated = true;
      observer = new MutationObserver(notifyResize);
      observer.observe(view.dom, { childList: true, characterData: true, subtree: true });
      view.dom.addEventListener('input', handleInput);
      view.dom.addEventListener('keydown', handleEscape, true);
      requestAnimationFrame(() => {
        if (!view || disposed) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
        view.focus();
      });
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      view?.dom.removeEventListener('input', handleInput);
      view?.dom.removeEventListener('keydown', handleEscape, true);
      void crepe.destroy();
    };
  }, [markdown]);

  return <div ref={root} className="dw-markdown-drawer-editor" role="textbox" aria-label="Markdown 编辑器" />;
}

function createEditorView(crepe: Crepe) {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx));
}

function getDocumentFlowHeight(dom: HTMLElement): number {
  const style = getComputedStyle(dom);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const flowBottom = [...dom.children]
    .filter((child) => {
      const childStyle = getComputedStyle(child);
      return childStyle.display !== 'none' && childStyle.position !== 'absolute' && childStyle.position !== 'fixed';
    })
    .reduce((bottom, child) => {
      const element = child as HTMLElement;
      return Math.max(bottom, element.offsetTop + element.offsetHeight);
    }, paddingTop);
  return Math.ceil(flowBottom + paddingBottom);
}
