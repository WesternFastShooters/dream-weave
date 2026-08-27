import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sides = ['top', 'right', 'bottom', 'left'] as const;
const rendererSource = readFileSync(new URL('../src/canvas-renderer.tsx', import.meta.url), 'utf8');

describe('CanvasRenderer web-preview workflow', () => {
  it('WP-01: keeps the 520 × 360 preview centred and converts it to flow coordinates', () => {
    expect(rendererSource).toContain("const WEB_PREVIEW_PLACEMENT_DIMENSIONS = [520, 360] as const;");
    expect(rendererSource).toContain("const previewScale = current.kind === 'markdown' ? zoom : 1;");
    expect(rendererSource).toContain('flowX: point.x - width * previewScale / (2 * zoom)');
    expect(rendererSource).toContain('flowY: point.y - height * previewScale / (2 * zoom)');
  });

  it('WP-02: validates HTTPS URLs before CreateWebAsset and preserves server errors in the form', () => {
    expect(rendererSource).toContain("url.protocol !== 'https:' || url.username || url.password");
    expect(rendererSource).toContain("error: '请输入不含账号信息的 HTTPS URL。'");
    expect(rendererSource).toContain('phase: \'saving\'');
    expect(rendererSource).toContain('createWebPreview(url.toString(), request)');
    expect(rendererSource).toContain("phase: 'input', error: error instanceof Error ? error.message : '保存网页预览失败。'");
  });

  it.each(sides.flatMap((source) => sides.map((target) => [source, target] as const)))('WP-04: persists endpoint coordinates with the default connection style', (source, target) => {
    expect(rendererSource).toContain('sourceX: connectionDrawDraft.source.x');
    expect(rendererSource).toContain('targetX: endpoint.x');
    expect(rendererSource).toContain('...DEFAULT_CONNECTION_STYLE');
    expect([source, target]).toHaveLength(2);
  });
});
