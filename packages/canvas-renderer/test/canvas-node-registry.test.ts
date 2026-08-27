import type { CanvasItem, CanvasItemKind } from '@dream-weave/canvas-core';
import { describe, expect, it } from 'vitest';
import { CanvasNodeRegistry } from '../src/canvas-node-registry.js';

const kinds: CanvasItemKind[] = ['markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame'];
const component = () => null;
function item(kind: CanvasItemKind): CanvasItem {
  const base = { id: kind, title: kind, summary: '', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' };
  switch (kind) {
    case 'markdown': return { ...base, kind, markdown: '' };
    case 'image': return { ...base, kind, assetId: 'a', previewAvailable: true, format: 'png' };
    case 'audio': return { ...base, kind, assetId: 'a', format: 'mp3', durationMs: 0, waveform: Array(64).fill(0), sceneLabel: '' };
    case 'video': return { ...base, kind, assetId: 'a', posterAvailable: true, durationMs: 0, shotLabel: '' };
    case 'web-preview': return { ...base, kind, assetId: 'a', url: 'https://example.test', embeddable: true };
    case 'html': return { ...base, kind, assetId: 'a', previewAvailable: true };
    case 'pdf': return { ...base, kind, assetId: 'a', previewAvailable: true };
    case 'office': return { ...base, kind, assetId: 'a', officeKind: 'word', fileType: 'docx', previewAvailable: true };
    case 'frame': return { ...base, kind, description: '', color: '#fff' };
  }
}
function completeRegistry(): CanvasNodeRegistry { const registry = new CanvasNodeRegistry(); for (const kind of kinds) registry.register({ kind, type: kind, component }); return registry; }

describe('CanvasNodeRegistry', () => {
  it('projects every discriminated node kind', () => {
    const registry = completeRegistry();
    const items = new Map(kinds.map((kind) => [kind, item(kind)]));
    const placements = new Map(kinds.map((kind, zIndex) => [kind, { itemId: kind, x: zIndex, y: 0, width: 100, height: 100, zIndex }]));
    const nodes = registry.project({ projectId: 'project', revision: 0, items, placements, connections: new Map() });
    expect(nodes).toHaveLength(9);
    expect(nodes.filter((node) => node.id !== 'frame').every((node) => node.dragHandle === '[data-drag-handle]')).toBe(true);
    expect(nodes.find((node) => node.id === 'frame')?.dragHandle).toBeUndefined();
  });
  it('always projects Frames behind the canvas content', () => {
    const registry = completeRegistry();
    const items = new Map(kinds.map((kind) => [kind, item(kind)]));
    const placements = new Map(kinds.map((kind, zIndex) => [kind, { itemId: kind, x: zIndex, y: 0, width: 100, height: 100, zIndex: kind === 'frame' ? 999 : zIndex }]));
    const nodes = registry.project({ projectId: 'project', revision: 0, items, placements, connections: new Map() });
    const frame = nodes.find((node) => node.id === 'frame');
    const contentZIndexes = nodes.filter((node) => node.id !== 'frame').map((node) => node.zIndex ?? 0);
    expect(frame?.zIndex).toBeLessThan(Math.min(...contentZIndexes));
  });
  it('projects legacy video nodes with a hit box that ends at the video card', () => {
    const registry = completeRegistry();
    const video = item('video');
    const placement = { itemId: video.id, x: 0, y: 0, width: 640, height: 620, zIndex: 0 };
    const node = registry.project({ projectId: 'project', revision: 0, items: new Map([[video.id, video]]), placements: new Map([[video.id, placement]]), connections: new Map() })[0];
    expect(node?.style).toMatchObject({ width: 640, height: 500 });
  });
  it('marks a requested new text node for immediate editing', () => {
    const registry = completeRegistry();
    const markdown = item('markdown');
    const placement = { itemId: markdown.id, x: 0, y: 0, width: 550, height: 100, zIndex: 0 };
    const node = registry.project({ projectId: 'project', revision: 0, items: new Map([[markdown.id, markdown]]), placements: new Map([[markdown.id, placement]]), connections: new Map() }, { startEditingItemId: markdown.id })[0];
    expect(node?.data.startEditing).toBe(true);
  });
  it('rejects duplicate and incomplete registrations and missing placement', () => {
    const registry = new CanvasNodeRegistry();
    registry.register({ kind: 'markdown', type: 'markdown', component });
    expect(() => registry.register({ kind: 'markdown', type: 'markdown-two', component })).toThrow(/already registered/);
    expect(() => registry.project({ projectId: 'project', revision: 0, items: new Map(), placements: new Map(), connections: new Map() })).toThrow(/incomplete/);
    const full = completeRegistry();
    expect(() => full.project({ projectId: 'project', revision: 0, items: new Map([['markdown', item('markdown')]]), placements: new Map(), connections: new Map() })).toThrow(/no placement/);
  });
});
