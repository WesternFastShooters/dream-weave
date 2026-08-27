import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
import { TextSelection } from '@milkdown/prose/state';
import { replaceAll } from '@milkdown/utils';
import './markdown-editor-frame.css';

const sessionId = new URLSearchParams(window.location.search).get('session');
const root = document.getElementById('root');
if (!sessionId || !root) throw new Error('Markdown editor frame requires a session and root element.');

let view = null;
let editable = false;
let initialized = false;
let editorReady = false;
let pendingInit = null;
let contentObserver = null;
let notifyResize = () => {};

// The node preview deliberately runs in a sandboxed document. Events in that
// document do not bubble to the canvas page, so the canvas-wide guard cannot
// prevent a trackpad pinch here. Install the same document-level policy once
// for this isolated runtime rather than adding handlers to editor controls.
function preventBrowserZoom(event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function preventNativeGestureZoom(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function preventMultiTouchPageZoom(event) {
  if (event.touches.length < 2) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

document.addEventListener('wheel', preventBrowserZoom, { capture: true, passive: false });
document.addEventListener('gesturestart', preventNativeGestureZoom, { capture: true, passive: false });
document.addEventListener('gesturechange', preventNativeGestureZoom, { capture: true, passive: false });
document.addEventListener('touchmove', preventMultiTouchPageZoom, { capture: true, passive: false });

function notify(type, payload = {}) {
  window.parent.postMessage({ type, sessionId, ...payload }, '*');
}

function getDocumentFlowHeight(dom) {
  const style = getComputedStyle(dom);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const flowBottom = [...dom.children]
    .filter((child) => {
      const childStyle = getComputedStyle(child);
      return childStyle.display !== 'none' && childStyle.position !== 'absolute' && childStyle.position !== 'fixed';
    })
    .reduce((bottom, child) => Math.max(bottom, child.offsetTop + child.offsetHeight), paddingTop);
  return Math.ceil(flowBottom + paddingBottom);
}

function dismissEditorUi() {
  root.querySelectorAll('.milkdown [data-show]').forEach((element) => { element.dataset.show = 'false'; });
  if (view && !view.state.selection.empty) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.from))));
  }
  view?.dom.blur();
  window.getSelection()?.removeAllRanges();
}

function focusEditorAtDocumentEnd() {
  if (!view) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  view.focus();
}

function setEditable(nextEditable, focus = false, focusAtDocumentEnd = false) {
  editable = nextEditable;
  crepe.setReadonly(!nextEditable);
  root.classList.toggle('is-editing', nextEditable);
  root.classList.toggle('is-readonly', !nextEditable);
  if (!nextEditable) dismissEditorUi();
  if (nextEditable) requestAnimationFrame(() => {
    notifyResize();
    if (focusAtDocumentEnd) focusEditorAtDocumentEnd();
    else if (focus) view?.focus();
  });
}

function applyInit(message) {
  if (!editorReady) {
    pendingInit = message;
    return;
  }
  if (!initialized) {
    initialized = true;
    crepe.editor.action(replaceAll(message.markdown, true));
  }
  setEditable(message.editable, message.editable, message.focusAtDocumentEnd ?? message.editable);
  requestAnimationFrame(() => notify('dream-weave:markdown:hydrated'));
}

const crepe = new Crepe({
  root,
  defaultValue: '',
  features: {
    [Crepe.Feature.TopBar]: false,
    [Crepe.Feature.AI]: false,
    [Crepe.Feature.ImageBlock]: false,
    // Crepe's CodeMirror feature owns the Playground-style code block: it
    // provides syntax highlighting, copy controls, and the language picker.
    [Crepe.Feature.CodeMirror]: true,
    [Crepe.Feature.Latex]: false,
  },
  featureConfigs: {
    // Crepe defaults CodeMirror to oneDark. `null` deliberately survives its
    // deep-default merge, keeping the frame on CodeMirror's light base theme
    // while retaining Crepe's complete built-in language catalogue.
    [Crepe.Feature.CodeMirror]: { theme: null, copyText: '复制代码' },
    [Crepe.Feature.Cursor]: { virtual: false },
    [Crepe.Feature.Placeholder]: { mode: 'doc', text: '输入 Markdown，使用 / 插入块' },
    [Crepe.Feature.BlockEdit]: {
      textGroup: {
        label: '文本', text: { label: '正文' }, h1: { label: '标题 1' }, h2: { label: '标题 2' }, h3: { label: '标题 3' },
        h4: { label: '标题 4' }, h5: { label: '标题 5' }, h6: { label: '标题 6' }, quote: { label: '引用' }, divider: { label: '分割线' },
      },
      listGroup: { label: '列表', bulletList: { label: '无序列表' }, orderedList: { label: '有序列表' }, taskList: { label: '待办列表' } },
      advancedGroup: { label: '高级', image: { label: '图片' }, codeBlock: { label: '代码块' }, table: { label: '表格' }, math: { label: '公式' } },
    },
  },
});

crepe.on((listener) => listener.markdownUpdated((_ctx, markdown) => {
  if (editable) notify('dream-weave:markdown:draft', { markdown });
}));

// This document intentionally has an opaque origin (`sandbox="allow-scripts"`),
// so the Clipboard API and `execCommand('copy')` are unavailable here. Intercept
// Crepe's built-in copy control before it attempts either API, then ask the
// trusted canvas document to perform the write on this frame's behalf.
window.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const copyButton = target?.closest('.milkdown-code-block .copy-button');
  if (!copyButton) return;
  const codeBlock = copyButton.closest('.milkdown-code-block');
  if (!codeBlock) return;
  const code = [...codeBlock.querySelectorAll('.cm-line')]
    .map((line) => line.textContent ?? '')
    .join('\n');
  event.preventDefault();
  event.stopImmediatePropagation();
  notify('dream-weave:markdown:copy-code', { code });
}, true);

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data || event.data.sessionId !== sessionId) return;
  const message = event.data;
  if (message.type === 'dream-weave:markdown:init') {
    applyInit(message);
  } else if (message.type === 'dream-weave:markdown:set-editable') {
    setEditable(message.editable, message.editable, message.editable);
  } else if (message.type === 'dream-weave:markdown:set-markdown' && !editable) {
    crepe.editor.action(replaceAll(message.markdown, true));
  }
});

window.addEventListener('keydown', (event) => {
  if (!editable || event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  notify('dream-weave:markdown:escape', { markdown: crepe.getMarkdown() });
}, true);

void crepe.create().then(() => {
  view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
  editorReady = true;
  crepe.setReadonly(true);
  let pendingResize = false;
  notifyResize = () => {
    if (pendingResize) return;
    pendingResize = true;
    requestAnimationFrame(() => {
      pendingResize = false;
      // Contextual UI is rendered either by TooltipProvider or as absolutely
      // positioned descendants (Slash, code picker, and table controls).
      // Neither their boxes nor their overflow may grow the canvas node.
      notify('dream-weave:markdown:resize', { height: view ? getDocumentFlowHeight(view.dom) : 0 });
    });
  };
  contentObserver = new MutationObserver(notifyResize);
  contentObserver.observe(view.dom, { childList: true, characterData: true, subtree: true });
  view.dom.addEventListener('input', notifyResize);
  notifyResize();
  if (pendingInit) {
    const init = pendingInit;
    pendingInit = null;
    applyInit(init);
  }
  notify('dream-weave:markdown:ready');
}, () => notify('dream-weave:markdown:failed'));

window.addEventListener('beforeunload', () => {
  contentObserver?.disconnect();
  void crepe.destroy();
});
