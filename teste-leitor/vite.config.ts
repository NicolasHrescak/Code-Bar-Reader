import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ipcam': {
        target: 'http://192.168.200.75:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ipcam/, ''),
      },
    },
  },
})
