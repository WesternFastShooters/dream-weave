import { CanvasNodeRegistry } from '@dream-weave/canvas-renderer';
import { AudioNode, FrameNode, HtmlViewerNode, ImageNode, MarkdownNode, OfficeNode, PdfNode, VideoNode, WebPreviewNode } from './nodes.js';

/** The only product-node registry. Exactly one renderer is registered per persisted kind. */
export function createCreativeNodeRegistry(): CanvasNodeRegistry {
  const registry = new CanvasNodeRegistry();
  registry.register({ kind: 'markdown', type: 'dream-weave-markdown', component: MarkdownNode });
  registry.register({ kind: 'image', type: 'dream-weave-image', component: ImageNode });
  registry.register({ kind: 'audio', type: 'dream-weave-audio', component: AudioNode });
  registry.register({ kind: 'video', type: 'dream-weave-video', component: VideoNode });
  registry.register({ kind: 'web-preview', type: 'dream-weave-web-preview', component: WebPreviewNode });
  registry.register({ kind: 'html', type: 'dream-weave-html', component: HtmlViewerNode });
  registry.register({ kind: 'pdf', type: 'dream-weave-pdf', component: PdfNode });
  registry.register({ kind: 'office', type: 'dream-weave-office', component: OfficeNode });
  registry.register({ kind: 'frame', type: 'dream-weave-frame', component: FrameNode });
  return registry;
}
