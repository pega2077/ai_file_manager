import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: 'builds/renderer',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        // Avoid bundling Sequelize and optional dialect deps into main process bundle.
        // This prevents Rollup from turning optional requires into static imports (e.g., 'pg-hstore').
        vite: {
          build: {
            outDir: 'builds/electron',
            rollupOptions: {
              external: [
                'sequelize',
                'sqlite3',
                'pg-hstore',
                'pg',
                'mysql2',
                'tedious',
                'mariadb',
                'faiss-node',
              ],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'builds/electron',
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
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



