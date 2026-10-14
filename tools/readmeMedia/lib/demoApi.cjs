/**
 * Preload of the hidden window the REAL client (client/, served by Vite) runs in for the README
 * pictures. It sets `window.autosync` before the app's own code starts, so `client/src/main.tsx`
 * keeps it instead of its dev fake. Everything it answers comes from capture.mjs (ipc
 * `demo:scene`, built from lib/demoData.mjs), and capture.mjs can push a new status at any
 * moment (`demo:status`) — the app hears it through its own `onStatus` listeners, as it hears the
 * main process in real use. It also fixes the page's clock at the scene's NOW.
 *
 * Every call of the full `AutoSyncApi` (shared/api.ts) is answered; the ones that would reach the
 * operating system (Finder, a browser, the clipboard, a native menu) only record that they were
 * asked. Runs with contextIsolation off, so it shares the page's `window`.
 */
const { ipcRenderer } = require('electron')

const scene = ipcRenderer.sendSync('demo:scene')

// ---------------------------------------------------------------- the clock
// The page's Date reads the scene's NOW (moved only by `demo:clock`), so "3m ago" never drifts.
const RealDate = Date
let now = scene.now
class SceneDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now)
    else super(...args)
  }
  static now() {
    return now
  }
}
window.Date = SceneDate

// A still shows the resting look: scroll bars hidden as macOS keeps them until you scroll, and
// every CSS animation (the pulsing dot, the spinning arrows) held on its first frame.
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = '::-webkit-scrollbar { display: none; } *, *::before, *::after { animation-play-state: paused !important; }'
  document.head.append(style)
})

// ---------------------------------------------------------------- the API
let status = scene.status
const statusListeners = new Set()
const navigateListeners = new Set()
const asked = []

function set(next) {
  status = next
  for (const listener of statusListeners) listener(status)
  return Promise.resolve(status)
}
const patch = (id, change) => set({ ...status, folders: status.folders.map((f) => (f.id === id ? { ...f, ...change } : f)) })
const record = (name, ...args) => {
  asked.push([name, ...args])
  return Promise.resolve()
}

ipcRenderer.on('demo:status', (_event, next) => void set(next))
ipcRenderer.on('demo:navigate', (_event, target) => navigateListeners.forEach((listener) => listener(target)))
ipcRenderer.on('demo:clock', (_event, time) => (now = time))

/** @type {import('../../../shared/api').AutoSyncApi} */
window.autosync = {
  getStatus: () => Promise.resolve(status),
  onStatus(listener) {
    statusListeners.add(listener)
    return () => statusListeners.delete(listener)
  },
  onNavigate(listener) {
    navigateListeners.add(listener)
    return () => navigateListeners.delete(listener)
  },
  pickFolder: () => Promise.resolve(scene.pick),
  checkFolder: (path) => Promise.resolve(scene.verdicts[path] ?? { ok: false, path, reason: 'not-git' }),
  addFolder: (path) => record('addFolder', path).then(() => status),
  removeFolder: (id) => set({ ...status, folders: status.folders.filter((f) => f.id !== id) }),
  setFolderEnabled: (id, enabled) => patch(id, { enabled, state: enabled ? 'synced' : 'off' }),
  setPaused: (paused) => set({ ...status, paused }),
  syncNow: (id) => record('syncNow', id),
  resendPullRequest: (id) => record('resendPullRequest', id),
  activity(id, cursor = 0) {
    const all = scene.activity[id] ?? []
    const next = cursor + 200
    return Promise.resolve({ entries: all.slice(cursor, next), cursor: next < all.length ? next : null })
  },
  setLaunchAtLogin: (on) => set({ ...status, launchAtLogin: on }),
  setTheme: (theme) => set({ ...status, theme }),
  showInFinder: (id) => record('showInFinder', id),
  openExternal: (url) => record('openExternal', url),
  copyText: (text) => record('copyText', text),
  showFolderMenu: (id) => record('showFolderMenu', id),
  setAlias: (id, alias) => patch(id, { alias, name: alias ?? id }),
  openInTerminal: (id) => record('openInTerminal', id),
  openInEditor: (id) => record('openInEditor', id),
}
window.__demoAsked = asked
