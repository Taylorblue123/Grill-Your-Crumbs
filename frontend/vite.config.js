import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* 开发时把 /api 代到本地后端，前端代码里就只写相对路径。
   生产构建同样只发相对请求，由反向代理决定后端在哪。 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.GRILL_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
