import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import toolbarSource from '../src/canvas-bottom-toolbar.tsx?raw';
import rendererSource from '../src/canvas-renderer.tsx?raw';

const rendererStyles = readFileSync(new URL('../src/canvas-renderer.css', import.meta.url), 'utf8');

describe('CanvasBottomToolbar upload input', () => {
  it('limits the chooser to supported asset and markdown formats', () => {
    expect(toolbarSource).toContain('type="file" accept={UPLOAD_FILE_ACCEPT} multiple');
    expect(toolbarSource).toContain("const UPLOAD_FILE_ACCEPT = '.md,.markdown,.txt,.text");
    for (const extension of ['.png', '.mp3', '.mp4', '.html', '.pdf', '.docx', '.xlsx', '.pptx']) {
      expect(toolbarSource).toContain(extension);
    }
  });

  it('puts the hand tool first and exposes rectangular and line lasso choices', () => {
    const handTool = toolbarSource.indexOf('aria-label="手形工具"');
    const pointerTool = toolbarSource.indexOf('aria-label={selectedLassoToolMode');
    expect(handTool).toBeGreaterThan(-1);
    expect(pointerTool).toBeGreaterThan(handTool);
    expect(toolbarSource).toContain('<span>矩形套索</span>');
    expect(toolbarSource).toContain('<span>线条套索</span>');
    expect(toolbarSource).toContain("chooseLassoTool('freeform-lasso')");
    expect(toolbarSource).not.toContain('<kbd>');
    expect(toolbarSource).toContain("onLassoShapeChange?.(nextToolMode === 'freeform-lasso' ? 'line' : 'rectangle')");
    expect(toolbarSource).toContain("setTool('pointer')");
  });

  it('dismisses the lasso submenu on a canvas click or Escape', () => {
    expect(toolbarSource).toContain("document.addEventListener('pointerdown', dismissOnPointerDown, true)");
    expect(toolbarSource).toContain("document.addEventListener('keydown', dismissOnKeyDown)");
    expect(toolbarSource).toContain("if (event.key === 'Escape') setLassoMenuOpen(false)");
  });

  it('uses a horizontal chevron that points right when expanded and left when collapsed', () => {
    expect(toolbarSource).toContain('d="m9 5 7 7-7 7"');
    expect(toolbarSource).toContain("className={open ? 'is-expanded' : 'is-collapsed'}");
    expect(rendererStyles).toContain('.dw-bottom-toolbar__chevron svg.is-collapsed { transform:rotate(180deg); }');
  });

  it('renders the supplied lasso marks with the same current color as the toolbar icons', () => {
    expect(toolbarSource).toContain('viewBox="0 0 1024 1024"');
    expect(toolbarSource).toContain('viewBox="0 0 24 24"');
    expect(toolbarSource).toContain('M4.037 4.688');
    expect(toolbarSource).toContain('M900.48 276.48');
    expect(toolbarSource).toContain('M993.28 225.28');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__button .dw-bottom-toolbar__lasso-icon,.dw-bottom-toolbar__menu .dw-bottom-toolbar__lasso-icon { fill:currentColor; stroke:none; }');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__button .dw-bottom-toolbar__pointer-icon { fill:none; stroke:currentColor; stroke-width:2; }');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__menu span { white-space:nowrap; }');
  });

  it('starts a line lasso only with Option on macOS or Alt on Windows', () => {
    expect(rendererSource).toContain('const shouldStartFreeformLasso = isPointerTool && event.altKey;');
    expect(rendererSource).toContain('selectionOnDrag={isPointerTool}');
    expect(rendererStyles).not.toContain("[data-dream-weave-canvas-renderer][data-freeform-lasso='true'] .react-flow__selection");
  });

  it('uses compact right-facing tooltips for the left action rail', () => {
    expect(toolbarSource).toBeTruthy();
    expect(rendererStyles).toContain('border-radius:8px');
    expect(rendererStyles).toContain('padding:8px 16px');
    expect(rendererStyles).toContain('font:500 12px/16px');
    expect(rendererStyles).toContain('width:6px; height:12px');
  });

  it('anchors the action rail vertically on the left and opens related overlays to the right', () => {
    expect(rendererStyles).toContain('left:max(16px, env(safe-area-inset-left)); top:50%; display:flex; flex-direction:column;');
    expect(rendererStyles).toContain('transform:translateY(-50%)');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__tool-group { position:relative; display:flex; flex-direction:column;');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__menu { position:absolute; top:50%; left:44px;');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__error { position:absolute; top:50%; left:44px;');
  });

  it('shows each tool shortcut in its tooltip', () => {
    expect(toolbarSource).toContain('data-tooltip="手形工具 H"');
    expect(toolbarSource).toContain("'矩形套索 V'");
    expect(toolbarSource).toContain("'线条套索 V'");
    expect(toolbarSource).toContain('data-tooltip="添加文本 T"');
    expect(toolbarSource).toContain('data-tooltip="添加网页预览 W"');
    expect(toolbarSource).toContain('data-tooltip="画框工具 F"');
  });

  it('places the Frame drawing action immediately before file upload', () => {
    const frameAction = toolbarSource.indexOf('aria-label="画框工具"');
    const fileAction = toolbarSource.indexOf('aria-label="添加文件"');
    expect(frameAction).toBeGreaterThan(-1);
    expect(fileAction).toBeGreaterThan(frameAction);
    expect(toolbarSource).toContain('onBeginFrameDrawing');
    expect(toolbarSource).toContain('data-tooltip="画框工具 F"');
  });

  it('uses the text node document icon for the add-text action', () => {
    const textAction = toolbarSource.match(/aria-label="添加文本"[^>]*>(.*?)<\/button>/s)?.[1];
    expect(textAction).toContain('<TextDocumentIcon />');
    expect(toolbarSource).toContain('function TextDocumentIcon(): ReactElement');
    expect(toolbarSource).toContain('dw-bottom-toolbar__text-document-icon');
    expect(toolbarSource).toContain('M14.04 1.001');
    expect(rendererStyles).toContain('.dw-bottom-toolbar__button .dw-bottom-toolbar__text-document-icon { fill:currentColor; stroke:none; }');
  });
});
