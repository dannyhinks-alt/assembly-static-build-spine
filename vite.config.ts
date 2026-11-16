import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Default build  -> ONE self-contained dist/index.html (opens from file://, works on GitHub Pages).
// `--mode static` -> conventional chunked static build (needs an http(s) origin, e.g. GitHub Pages).
// Either way there are zero runtime network requests: no CDNs, no web fonts, no telemetry.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'static' ? [] : [viteSingleFile()])],
  build: {
    target: 'es2020',
    outDir: mode === 'static' ? 'dist-static' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
