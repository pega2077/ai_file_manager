import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'

// Vite config for standalone web build (no Electron)
export default defineConfig({
  build: {
    outDir: 'builds/web',
    emptyOutDir: true,
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // Locales now live inside client/locales
      '@locales': path.resolve(__dirname, 'locales'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
})
