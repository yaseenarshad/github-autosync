import type { AutoSyncApi } from './api'

/** What the preload exposes (desktop/src/preload/index.ts); the renderer calls it as `window.autosync`. */
declare global {
  interface Window {
    autosync: AutoSyncApi
  }
}

export {}
