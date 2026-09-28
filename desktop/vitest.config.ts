import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'desktop',
    environment: 'node',
    // `shared/` has no project of its own; its pure tests run here under node.
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
    // chokidar tests write right after `ready`; stat polling makes that deterministic (macOS FSEvents start asynchronously).
    env: { CHOKIDAR_USEPOLLING: '1' },
  },
})
