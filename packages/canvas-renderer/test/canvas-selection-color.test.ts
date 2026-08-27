import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import nodeFrameStyleSource from '../src/canvas-node-frame-style.ts?raw';

const rendererStyles = readFileSync(new URL('../src/canvas-renderer.css', import.meta.url), 'utf8');

describe('canvas selection color', () => {
  it('keeps the node selection token while connection drawing no longer exposes node handles', () => {
    expect(rendererStyles).toContain('--dream-weave-canvas-selection-color: #88b5ff;');
    expect(rendererStyles).toContain('.dw-floating-connections');
    expect(rendererStyles).not.toContain('.dw-connection-handle');
    expect(nodeFrameStyleSource).toContain("outline: '2px solid var(--dream-weave-canvas-selection-color, #88B5FF)'");
  });
});
