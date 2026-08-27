import {
  createProjectCanvasContainer,
  HttpCanvasDocumentRepository,
  ICanvasDocumentService,
  ICanvasHistoryService,
} from '@dream-weave/canvas-core';
import {
  createWorkspaceCanvasInteractionContainer,
  ICanvasInteractionService,
} from '@dream-weave/canvas-interaction';
import { CanvasRenderer } from '@dream-weave/canvas-renderer';
import {
  CreativeNodeRuntimeProvider,
  CanvasSideDrawerProvider,
  createCreativeNodeRegistry,
} from '@dream-weave/creative-nodes';
import '@dream-weave/canvas-renderer/canvas-renderer.css';
import '@dream-weave/creative-nodes/creative-nodes.css';
import '@dream-weave/creative-nodes/product-brief.css';
import {
  getService,
  InstantiationContext,
  InstantiationService,
} from '@dream-weave/di';
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createProjectCanvasApi,
  createProjectCanvasRuntime,
} from './composition/create-project-runtime.js';
import { CanvasAppShell } from './canvas-app-shell.js';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const projectId = new URLSearchParams(window.location.search).get('projectId');
const localAutoLogin = import.meta.env.DEV
  ? { email: import.meta.env.VITE_DW_LOCAL_AUTO_LOGIN_EMAIL, password: import.meta.env.VITE_DW_LOCAL_AUTO_LOGIN_PASSWORD }
  : undefined;
const rememberedProjectKey = 'dream-weave.local.project-id';

async function start(projectId: string): Promise<void> {
  const container = new InstantiationService();
  const api = createProjectCanvasApi();
  const repository = new HttpCanvasDocumentRepository(api.canvas);
  const workspace = createWorkspaceCanvasInteractionContainer(
    createProjectCanvasContainer(container, { projectId, repository }),
  );
  const documentService = getService(workspace, ICanvasDocumentService);
  const historyService = getService(workspace, ICanvasHistoryService);
  const interaction = getService(workspace, ICanvasInteractionService);

  await documentService.initialize();
  const runtime = createProjectCanvasRuntime({
    projectId,
    api,
    document: documentService,
    history: historyService,
    interaction,
    // Keep this as a public multi-page entry. Passing the HTML file through
    // `new URL(..., import.meta.url)` makes Vite treat it as an asset, which
    // leaves its development `/src/...` module path inside the production
    // output and produces a blank sandboxed editor.
    markdownEditorFrameUrl: '/markdown-editor-frame.html',
  });

  root.render(
    <StrictMode>
      <InstantiationContext instantiationService={workspace}>
        <CreativeNodeRuntimeProvider value={runtime.nodes}>
          <CanvasSideDrawerProvider>
            <CanvasAppShell subtitle="Project canvas">
              <CanvasRenderer
                className="canvas-app__canvas"
                nodeRegistry={createCreativeNodeRegistry()}
                assetUpload={runtime.assetUpload}
                createWebPreview={runtime.createWebPreview}
              />
            </CanvasAppShell>
          </CanvasSideDrawerProvider>
        </CreativeNodeRuntimeProvider>
      </InstantiationContext>
    </StrictMode>,
  );
}

function LoginScreen({ returnProjectId, initialError }: { returnProjectId?: string; initialError?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function authenticate(loginEmail: string, loginPassword: string): Promise<void> {
    setSubmitting(true);
    setError('');
    try {
      const login = await fetch('/api/dreamweave/v1/auth/sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!login.ok) throw new Error(await responseMessage(login));

      const existingProjectId = returnProjectId ?? window.localStorage.getItem(rememberedProjectKey);
      if (existingProjectId) {
        openProject(existingProjectId);
        return;
      }
      const project = await fetch('/api/dreamweave/v1/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled project', summary: '' }),
      });
      if (!project.ok) throw new Error(await responseMessage(project));
      const created = await project.json() as { id?: unknown };
      if (typeof created.id !== 'string' || !created.id) throw new Error('Project creation returned no project id.');
      window.localStorage.setItem(rememberedProjectKey, created.id);
      openProject(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await authenticate(email, password);
  }

  useEffect(() => {
    if (localAutoLogin?.email && localAutoLogin.password) {
      void authenticate(localAutoLogin.email, localAutoLogin.password);
    }
  }, []);

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <p className="login-card__eyebrow">Dream Weave</p>
        <h1>Open your canvas</h1>
        <p>Sign in with the bootstrap administrator credentials from <code>infra/compose/local/.env</code>.</p>
        <label>Email<input autoComplete="email" name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label>Password<input autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        {error && <p className="login-card__error" role="alert">{error}</p>}
        <button disabled={submitting} type="submit">{submitting ? 'Opening…' : 'Sign in and create project'}</button>
      </form>
    </main>
  );
}

function openProject(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('projectId', id);
  window.location.assign(url);
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown };
    if (typeof payload.message === 'string' && payload.message) return payload.message;
  } catch { /* fall through to the HTTP status */ }
  return `Request failed (${response.status}).`;
}

if (!projectId) {
  root.render(<LoginScreen />);
} else {
  void start(projectId).catch((reason: unknown) => {
    if (window.localStorage.getItem(rememberedProjectKey) === projectId) window.localStorage.removeItem(rememberedProjectKey);
    const message = reason instanceof Error ? reason.message : 'Unable to open this project.';
    root.render(<LoginScreen initialError={message} returnProjectId={isAuthenticationError(reason) ? projectId : undefined} />);
  });
}

function isAuthenticationError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'status' in reason && reason.status === 401;
}
