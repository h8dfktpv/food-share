import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 基础配置：本地开发端口 5173，构建输出 dist（Vercel 默认读取该目录）
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    target: 'es2020',
    sourcemap: false
  }
})
