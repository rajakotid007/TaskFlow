/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

// The dev server proxies the API and the Action Cable socket, so the browser
// talks to a single origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/cable': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
