import {
  createProjectCanvasContainer,
  ICanvasDocumentService,
  ICanvasHistoryService,
  InMemoryCanvasDocumentRepository,
  type CanvasItem,
  type ICanvasDocumentService as CanvasDocumentService,
  type ICanvasHistoryService as CanvasHistoryService,
} from '@dream-weave/canvas-core';
import {
  createWorkspaceCanvasInteractionContainer,
  ICanvasInteractionService,
} from '@dream-weave/canvas-interaction';
import { CanvasRenderer } from '@dream-weave/canvas-renderer';
import {
  CanvasNodeToolbarService,
  CanvasSideDrawerProvider,
  CreativeNodeRuntimeProvider,
  CreativeNodeService,
  createCreativeNodeRegistry,
  type NodeRuntimeServices,
} from '@dream-weave/creative-nodes';
import '@dream-weave/canvas-renderer/canvas-renderer.css';
import '@dream-weave/creative-nodes/creative-nodes.css';
import '@dream-weave/creative-nodes/product-brief.css';
import {
  getService,
  InstantiationContext,
  InstantiationService,
} from '@dream-weave/di';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createProjectAssetUploadService } from '../../src/services/assets/project-asset-upload-service.js';
import { CanvasAppShell } from '../../src/canvas-app-shell.js';
import '../../src/styles.css';

const createdAt = '2026-07-22T00:00:00.000Z';
const projectId = 'fixture-project';
const pdfFixtureUrl = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFI gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1NSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcyMCBUZCAoRHJlYW0gV2VhdmUgUERGIGZpeHR1cmUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDE1CiUlRU9GCg=='.replace(' ', '');

async function start(): Promise<void> {
  const root = new InstantiationService();
  const workspace = createWorkspaceCanvasInteractionContainer(
    createProjectCanvasContainer(root, {
      projectId,
      repository: new InMemoryCanvasDocumentRepository(),
    }),
  );
  const documentService = getService(workspace, ICanvasDocumentService);
  const historyService = getService(workspace, ICanvasHistoryService);
  const interaction = getService(workspace, ICanvasInteractionService);

  await documentService.initialize();
  seedFixture(historyService, projectId);
  const runtime = fixtureRuntime(documentService, historyService);
  const assetUpload = createProjectAssetUploadService({
    projectId,
    assets: { upload: fixtureUpload },
    document: documentService,
    history: historyService,
    interaction,
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <InstantiationContext instantiationService={workspace}>
        <CreativeNodeRuntimeProvider value={runtime}>
          <CanvasSideDrawerProvider>
            <CanvasAppShell subtitle="Canvas UI fixture">
              <CanvasRenderer
                className="canvas-app__canvas"
                nodeRegistry={createCreativeNodeRegistry()}
                assetUpload={assetUpload}
                createWebPreview={fixtureWebPreview(historyService)}
              />
            </CanvasAppShell>
          </CanvasSideDrawerProvider>
        </CreativeNodeRuntimeProvider>
      </InstantiationContext>
    </StrictMode>,
  );
}

function fixtureWebPreview(historyService: CanvasHistoryService) {
  return async (
    url: string,
    placement: { itemId: string; x: number; y: number; width: number; height: number; zIndex: number },
  ) => {
    const now = new Date().toISOString();
    historyService.execute({
      id: crypto.randomUUID(),
      projectId,
      createdAt: now,
      actor: 'user',
      type: 'create-item',
      item: {
        id: placement.itemId,
        kind: 'web-preview',
        title: new URL(url).hostname,
        summary: url,
        assetId: `fixture-${placement.itemId}`,
        url,
        embeddable: true,
        createdAt: now,
        updatedAt: now,
      },
      placement,
    });
  };
}

function fixtureRuntime(
  documentService: CanvasDocumentService,
  historyService: CanvasHistoryService,
): NodeRuntimeServices {
  const preview = {
    getPreview: async (assetId: string) => ({
      url: assetId === 'pdf' ? pdfFixtureUrl : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="500"%3E%3Crect width="100%25" height="100%25" fill="%23dce6ff"/%3E%3C/svg%3E',
      expiresAt: createdAt,
    }),
    getHtmlPreview: async () => ({ url: 'about:blank', expiresAt: createdAt }),
  };
  const toolbar = new CanvasNodeToolbarService(
    documentService,
    historyService,
    { download: async () => undefined },
  );
  return {
    markdown: new CreativeNodeService(documentService, historyService),
    markdownEditorFrameUrl: '/markdown-editor-frame.html',
    toolbar,
    preview,
    playback: undefined,
    office: {
      getSession: async (assetId) => ({
        sessionId: assetId === 'pdf' ? 'fixture-pdf-session' : 'fixture-office-session',
        documentServerUrl: 'https://office.test',
        documentUrl: 'https://office.test/source',
        documentKey: assetId === 'pdf' ? 'fixture-pdf-key' : 'fixture-office-key',
        token: 'fixture-office-token',
        documentTitle: assetId === 'pdf' ? '研究报告.pdf' : '演示文稿.pptx',
        fileType: assetId === 'pdf' ? 'pdf' as const : 'pptx' as const,
        documentType: assetId === 'pdf' ? 'pdf' as const : 'slide' as const,
        expiresAt: createdAt,
      }),
    },
  };
}

function defaultSize(kind: CanvasItem['kind']): readonly [number, number] {
  return ({
    markdown: [550, 100], image: [360, 360], audio: [640, 280], video: [640, 620],
    'web-preview': [520, 360], html: [560, 400], pdf: [420, 560], office: [520, 360], frame: [760, 520],
  } as const)[kind];
}

async function fixtureUpload(_projectId: string, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kind = ['apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpg', 'jpeg', 'png', 'svg', 'webp'].includes(extension) ? 'image'
    : ['wav', 'mp3', 'm4a', 'ogg'].includes(extension) ? 'audio'
      : ['mp4', 'mov', 'webm'].includes(extension) ? 'video'
        : extension === 'pdf' ? 'pdf'
          : ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension) ? 'office'
            : ['html', 'htm'].includes(extension) ? 'html'
              : null;
  if (!kind) throw new Error(`Unsupported fixture asset: ${file.name}`);
  return { id: `fixture-${crypto.randomUUID()}`, kind, displayName: file.name, processingState: 'ready' };
}

function seedFixture(history: CanvasHistoryService, currentProjectId: string): void {
  const search = new URLSearchParams(window.location.search);
  if (search.has('empty')) return;
  const allItems = fixtureItems();
  if (search.has('markdown-pair')) {
    allItems.push({ id: 'markdown-b', kind: 'markdown', title: '第二文本', summary: '连接目标', markdown: '连接目标', createdAt, updatedAt: createdAt });
  }
  if (search.has('code-block')) {
    const markdown = allItems.find((item) => item.id === 'markdown');
    if (markdown?.kind === 'markdown') markdown.markdown = '```js\nconst dream = "weave";\n```';
  }
  if (search.has('list-blocks')) {
    const markdown = allItems.find((item) => item.id === 'markdown');
    if (markdown?.kind === 'markdown') markdown.markdown = '- 无序项\n- 无序项\n\n1. 有序项\n2. 有序项\n\n- [ ] 待办项\n- [x] 已完成项';
  }
  const requestedPair = search.get('connection-pair')?.split(',') ?? [];
  const pairItems = requestedPair.length >= 2
    ? requestedPair.map((id) => allItems.find((item) => item.id === id)).filter((item): item is CanvasItem => item !== undefined)
    : [];
  const items = pairItems.length >= 2 ? pairItems : allItems;
  items.forEach((item, index) => history.execute({
    id: `fixture-${item.id}`,
    projectId: currentProjectId,
    createdAt,
    actor: 'user',
    type: 'create-item',
    item,
    placement: {
      itemId: item.id,
      // Connection-pair fixtures keep both rendered borders separate. The
      // ordinary visual fixture intentionally overlaps product cards.
      x: pairItems.length >= 2 ? 80 + index * 1320 : 60 + (index % 4) * 260,
      y: pairItems.length >= 2 ? 160 + index * 180 : 60 + Math.floor(index / 4) * 250,
      width: defaultSize(item.kind)[0],
      height: defaultSize(item.kind)[1],
      zIndex: index + 1,
    },
  }));
  if (!search.has('frame-child')) return;
  history.execute({
    id: 'fixture-frame-child',
    projectId: currentProjectId,
    createdAt,
    actor: 'user',
    type: 'create-item',
    item: { id: 'frame-child', kind: 'image', title: 'Frame child', summary: '', assetId: 'frame-child', previewAvailable: true, format: 'png', createdAt, updatedAt: createdAt },
    placement: { itemId: 'frame-child', x: 420, y: 690, width: 216, height: 216, zIndex: 1 },
  });
}

function fixtureItems(): CanvasItem[] {
  const base = <K extends CanvasItem['kind']>(id: string, kind: K, title: string) => ({
    id,
    kind,
    title,
    summary: title,
    createdAt,
    updatedAt: createdAt,
  }) as Extract<CanvasItem, { kind: K }>;
  const wave = Array.from({ length: 64 }, (_, index) => ((index % 7) + 1) / 8);
  return [
    { ...base('markdown', 'markdown', '项目笔记'), markdown: '# Dream Weave\n\n这是可编辑 Markdown。' },
    { ...base('image', 'image', '参考图片'), assetId: 'image', previewAvailable: true, format: 'png' },
    { ...base('audio', 'audio', '环境音'), assetId: 'audio', format: 'mp3', durationMs: 83000, waveform: wave, sceneLabel: '雨夜街道' },
    { ...base('video', 'video', '开场镜头'), assetId: 'video', posterAvailable: true, durationMs: 122000, shotLabel: '广角' },
    { ...base('web', 'web-preview', '网页参考'), assetId: 'web', url: 'https://example.com', embeddable: true },
    { ...base('html', 'html', '互动地图'), assetId: 'html', previewAvailable: true },
    { ...base('pdf', 'pdf', '研究报告'), assetId: 'pdf', previewAvailable: true },
    { ...base('office', 'office', '演示文稿'), assetId: 'office', officeKind: 'presentation', fileType: 'pptx', previewAvailable: true },
    { ...base('frame', 'frame', '第一幕'), description: '故事开端', color: '#eef0ff' },
  ];
}

void start();
