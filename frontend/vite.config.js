import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端默认跑在 127.0.0.1:8000（见 backend/README.md）。
// dev 时把 /api 代理过去，生产构建产物直接由 FastAPI 托管，两边同源。
const BACKEND = process.env.GRILL_BACKEND_ORIGIN || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
