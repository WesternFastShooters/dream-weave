import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CanvasNodeTitle } from '../src/canvas-node-title.js';

describe('CanvasNodeTitle', () => {
  it('uses the shared caption chrome and an icon for every persisted node kind', () => {
    const kinds = ['markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame'] as const;
    const view = render(createElement('div', null, kinds.map((kind) => createElement(CanvasNodeTitle, { key: kind, kind, title: `${kind}-title`, officeFileType: 'docx' }))));

    expect(view.container.querySelectorAll('.dw-canvas-node-title')).toHaveLength(kinds.length);
    expect(view.container.querySelectorAll('.dw-canvas-node-title__icon')).toHaveLength(kinds.length);
    expect([...view.container.querySelectorAll('.dw-canvas-node-title__label')].map((node) => node.textContent)).toEqual(kinds.map((kind) => `${kind}-title`));
  });

  it('selects the supplied Office glyphs by file extension', () => {
    for (const [fileType, viewBox] of [['docx', '0 0 1024 1024'], ['xlsx', '0 0 1024 1024'], ['pptx', '0 0 1024 1024']] as const) {
      const view = render(createElement(CanvasNodeTitle, { kind: 'office', title: fileType, officeFileType: fileType }));
      expect(view.container.querySelector('.dw-canvas-node-title__icon')?.getAttribute('viewBox')).toBe(viewBox);
    }
  });

  it('lets the image icon inherit the shared caption color', () => {
    const view = render(createElement(CanvasNodeTitle, { kind: 'image', title: 'image-title' }));

    expect(view.container.querySelector('.dw-canvas-node-title__icon path')?.getAttribute('fill')).toBeNull();
  });

  it('uses the supplied browser glyph for web previews and inherits the caption color', () => {
    const view = render(createElement(CanvasNodeTitle, { kind: 'web-preview', title: 'web-preview-title' }));
    const icon = view.container.querySelector('.dw-canvas-node-title__icon');

    expect(icon?.getAttribute('viewBox')).toBe('0 0 1024 1024');
    expect(icon?.querySelector('path')?.getAttribute('fill')).toBeNull();
  });
});
