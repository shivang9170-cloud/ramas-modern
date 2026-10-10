import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root: the client imports ../shared (calculation code shared with the API).
const repoRoot = path.resolve(here, '..');

// In dev, /api is proxied to the Express server so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  // `import … from 'antd'` → src/ui/antd.jsx: Ant Design adjusted to the chosen UI preset (form layout, where forms
  // open, where Save sits). The wrapper itself imports the real package as 'antd/es/index.js'.
  resolve: {
    alias: [{ find: /^antd$/, replacement: path.resolve(here, 'src/ui/antd.jsx') }],
  },
  server: {
    port: 5173,
    proxy: {
      // keep the browser's Host (and send X-Forwarded-Host): the API's CSRF check accepts a page served from the same host,
      // so the app works when opened by IP / another PC / a tunnel, not only as localhost:5173
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: false, xfwd: true },
    },
    // Allow both the given path and its real path: on Windows, folders under
    // redirected/virtualised locations (e.g. Store-app AppData) resolve elsewhere.
    fs: { allow: [...new Set([repoRoot, realpathSync.native(repoRoot)])] },
  },
  build: {
    // no source maps in the build: they would publish the app's source code
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // Split the big libraries into their own files: smaller downloads (better over a slow or tunnelled link) and they
    // stay cached when only the app code changes.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](echarts|zrender)[\\/]/.test(id)) return 'charts';
          if (/[\\/](antd|@ant-design|rc-[^\\/]+|@rc-component)[\\/]/.test(id)) return 'antd';
          // react-router's own engine (@remix-run/router) must sit with it, else react ↔ vendor import each other
          if (/[\\/](react|react-dom|react-router|react-router-dom|@remix-run|scheduler|@tanstack|use-sync-external-store)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
