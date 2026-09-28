import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = resolve(here, '../shared')
const client = resolve(here, '../client')

export default defineConfig({
  main: {
    // chokidar 4 is pure JS and gets bundled (electron-vite 5 externalizes deps by default), so the
    // packaged app needs no node_modules at all.
    resolve: { alias: { '@shared': shared } },
    build: { externalizeDeps: false, rollupOptions: { input: { index: resolve(here, 'src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: resolve(here, 'src/preload/index.ts') } },
  },
  renderer: {
    root: client,
    plugins: [react()],
    resolve: { alias: { '@shared': shared } },
    // electron-vite leaves minification off; the renderer is the one bundle big enough to care.
    build: { outDir: resolve(here, 'out/renderer'), minify: 'esbuild', rollupOptions: { input: resolve(client, 'index.html') } },
  },
})
