import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Run `vercel dev` (not `vite dev`) for local development.
// vercel dev serves both Vite and the api/ functions on the same port,
// so /api/index?service=X and /api/cron-* resolve to local functions.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/index':      { target: 'http://localhost:3000', changeOrigin: true },
      '/api/cron-daily': { target: 'http://localhost:3000', changeOrigin: true },
      '/api/cron-scout': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
