import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // Sandboxed preloads cannot require() shared chunks, so each entry must
      // be built as one self-contained bundle.
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          tab: resolve(__dirname, 'src/preload/tab.ts'),
          extensionCompat: resolve(__dirname, 'src/preload/extensionCompat.ts'),
          extensionPanel: resolve(__dirname, 'src/preload/extensionPanel.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          start: resolve(__dirname, 'src/renderer/start.html'),
          extensionMenu: resolve(__dirname, 'src/renderer/extensionMenu.html')
        }
      }
    }
  }
})
