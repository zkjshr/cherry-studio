import { defineConfig } from 'vite'

// 开发：本服务 8790，WS(/ws) 与 REST(/api) 代理到 world 服务 8788；
// 生产：vite build 产物 dist/ 由 world 服务静态托管（同源直连，无需代理）。
export default defineConfig({
  server: {
    port: 8790,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8788', ws: true },
      '/api': { target: 'http://localhost:8788', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
