// Plain `vite` for viewing the UI in a browser against src/dev/fakeApi.ts. The Electron build uses desktop/electron.vite.config.ts.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
})
