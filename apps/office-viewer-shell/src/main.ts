import { sessionIdFromPath, type OfficeSessionConfig } from './protocol.js';

const viewer = document.querySelector<HTMLElement>('#office-viewer');
const sessionId = sessionIdFromPath(window.location.pathname);
let disposed = false;
let editor: OnlyOfficeEditor | null = null;
let restoreIframeInterceptors: (() => void) | null = null;
let docsApiScript: HTMLScriptElement | null = null;

type ParentPreviewMessage =
  | { type: 'dream-weave:office-preview-ready'; sessionId: string }
  | { type: 'dream-weave:office-preview-error'; sessionId: string };

function render(message: string): void {
  if (viewer) viewer.textContent = message;
}

function notifyParent(type: ParentPreviewMessage['type']): void {
  if (!sessionId || window.parent === window) return;
  // The parent verifies this message's origin and session id before using it.
  // No document URL, token, or other capability is exposed by this signal.
  window.parent.postMessage({ type, sessionId } satisfies ParentPreviewMessage, '*');
}

function fail(_config: OfficeSessionConfig, _code: string): void {
  render('Office preview unavailable');
  notifyParent('dream-weave:office-preview-error');
}

/**
 * ONLYOFFICE creates its editor iframe synchronously while DocsAPI is loading.
 * Patch insertion before adding DocsAPI and retain the patch until destroyEditor,
 * so no editor iframe can be inserted without the exact sandbox token set.
 */
function installIframeSandboxInterceptors(): () => void {
  const nodePrototype = Node.prototype;
  const elementPrototype = Element.prototype;
  const childNodePrototype = Element.prototype;
  const originalAppendChild = nodePrototype.appendChild;
  const originalInsertBefore = nodePrototype.insertBefore;
  const originalReplaceChild = nodePrototype.replaceChild;
  const originalAppend = elementPrototype.append;
  const originalPrepend = elementPrototype.prepend;
  const originalReplaceChildren = elementPrototype.replaceChildren;
  const originalBefore = childNodePrototype.before;
  const originalAfter = childNodePrototype.after;
  const originalReplaceWith = childNodePrototype.replaceWith;
  const exactSandbox = 'allow-scripts allow-same-origin';

  const secure = (node: Node | string): void => {
    if (typeof node === 'string') return;
    if (node instanceof HTMLIFrameElement) node.setAttribute('sandbox', exactSandbox);
    if (node instanceof Element || node instanceof DocumentFragment) {
      node.querySelectorAll('iframe').forEach((frame) => frame.setAttribute('sandbox', exactSandbox));
    }
  };
  const secureAll = (nodes: (Node | string)[]): void => nodes.forEach(secure);

  nodePrototype.appendChild = function patchedAppendChild<T extends Node>(newChild: T): T { secure(newChild); return originalAppendChild.call(this, newChild) as T; };
  nodePrototype.insertBefore = function patchedInsertBefore<T extends Node>(newChild: T, referenceNode: Node | null): T { secure(newChild); return originalInsertBefore.call(this, newChild, referenceNode) as T; };
  nodePrototype.replaceChild = function patchedReplaceChild<T extends Node>(newChild: Node, oldChild: T): T { secure(newChild); return originalReplaceChild.call(this, newChild, oldChild) as T; };
  elementPrototype.append = function patchedAppend(...nodes: (Node | string)[]): void { secureAll(nodes); originalAppend.apply(this, nodes); };
  elementPrototype.prepend = function patchedPrepend(...nodes: (Node | string)[]): void { secureAll(nodes); originalPrepend.apply(this, nodes); };
  elementPrototype.replaceChildren = function patchedReplaceChildren(...nodes: (Node | string)[]): void { secureAll(nodes); originalReplaceChildren.apply(this, nodes); };
  childNodePrototype.before = function patchedBefore(...nodes: (Node | string)[]): void { secureAll(nodes); originalBefore.apply(this, nodes); };
  childNodePrototype.after = function patchedAfter(...nodes: (Node | string)[]): void { secureAll(nodes); originalAfter.apply(this, nodes); };
  childNodePrototype.replaceWith = function patchedReplaceWith(...nodes: (Node | string)[]): void { secureAll(nodes); originalReplaceWith.apply(this, nodes); };

  return () => {
    nodePrototype.appendChild = originalAppendChild;
    nodePrototype.insertBefore = originalInsertBefore;
    nodePrototype.replaceChild = originalReplaceChild;
    elementPrototype.append = originalAppend;
    elementPrototype.prepend = originalPrepend;
    elementPrototype.replaceChildren = originalReplaceChildren;
    childNodePrototype.before = originalBefore;
    childNodePrototype.after = originalAfter;
    childNodePrototype.replaceWith = originalReplaceWith;
  };
}

function destroyEditor(): void {
  disposed = true;
  try {
    editor?.destroyEditor?.();
  } finally {
    editor = null;
    docsApiScript?.remove();
    docsApiScript = null;
    restoreIframeInterceptors?.();
    restoreIframeInterceptors = null;
  }
}

function loadDocsApi(config: OfficeSessionConfig): void {
  // This is intentionally installed before the first DocsAPI network request.
  restoreIframeInterceptors = installIframeSandboxInterceptors();
  const script = document.createElement('script');
  docsApiScript = script;
  script.async = true;
  script.src = `${config.documentServerUrl.replace(/\/$/, '')}/web-apps/apps/api/documents/api.js`;
  script.onload = () => {
    if (disposed || !window.DocsAPI?.DocEditor) return fail(config, 'DOCS_API_UNAVAILABLE');
    try {
      editor = new window.DocsAPI.DocEditor('office-viewer', {
        type: 'embedded',
        document: {
          fileType: config.fileType,
          key: config.documentKey,
          title: config.documentTitle,
          url: config.documentUrl,
          permissions: {
            edit: false,
            download: false,
            print: false,
            comment: false,
            copy: false,
          },
        },
        documentType: config.documentType,
        editorConfig: {
          mode: 'view',
          coEditing: { mode: 'strict', change: false },
          embedded: { autostart: 'document', toolbarDocked: 'bottom' },
          customization: {
            compactHeader: true,
            compactToolbar: true,
            hideRulers: true,
            hideRightMenu: true,
            showHorizontalScroll: false,
            showVerticalScroll: false,
            toolbarNoTabs: true,
          },
        },
        events: {
          onDocumentReady: () => {
            if (!disposed) {
              render('');
              notifyParent('dream-weave:office-preview-ready');
            }
          },
          onError: (event) => fail(config, `DOCS_API_${String(event.data?.errorCode ?? 'ERROR').replace(/[^A-Za-z0-9_]/g, '_')}`),
        },
        token: config.token,
      });
    } catch {
      fail(config, 'EDITOR_INITIALIZATION_FAILED');
    }
  };
  script.onerror = () => fail(config, 'DOCS_API_LOAD_FAILED');
  document.head.appendChild(script);
}

async function loadSession(): Promise<void> {
  if (!sessionId) {
    render('Office preview unavailable');
    return;
  }
  try {
    const response = await fetch(`/internal/office-viewer-sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok || disposed) throw new Error('office session unavailable');
    const config = await response.json() as OfficeSessionConfig;
    if (disposed) return;
    render('Loading read-only document preview…');
    loadDocsApi(config);
  } catch {
    if (!disposed) {
      render('Office preview unavailable');
      notifyParent('dream-weave:office-preview-error');
    }
  }
}

void loadSession();
window.addEventListener('pagehide', destroyEditor, { once: true });
