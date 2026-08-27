import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    // A sandboxed iframe without allow-same-origin has an opaque origin, so
    // its module graph must be served with CORS even though it is hosted by
    // this application.
    cors: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        markdownEditor: resolve(import.meta.dirname, 'markdown-editor-frame.html'),
      },
    },
  },
});
