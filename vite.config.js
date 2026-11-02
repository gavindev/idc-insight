import { defineConfig } from 'vite';

export default defineConfig({
  // 生产镜像以 /idc_insight/ 为 base 构建（Dockerfile 注入 VITE_BASE），
  // 本地 dev/preview 默认 '/'；服务端会剥离前缀，根路径访问同样可用。
  base: process.env.VITE_BASE || '/',
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 开发模式下，/api 转发到 CMDB 后端（node server/server.js）
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
