import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      // 多页入口：/ 是产品介绍页，/app.html 才是画布应用
      input: {
        intro: 'index.html',
        app: 'app.html',
      },
    },
  },
})
