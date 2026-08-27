// pdf.js probes these browser canvas primitives during module evaluation.
// jsdom does not provide them, while production Chromium does.
if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = class DOMMatrix {} as typeof DOMMatrix;
}

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {} as typeof ImageData;
}

if (!globalThis.Path2D) {
  globalThis.Path2D = class Path2D {} as typeof Path2D;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}
