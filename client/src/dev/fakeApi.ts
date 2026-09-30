// Browser-only stand-in for the preload API (plain `vite`, no Electron), seeded like the approved demo.
// Loaded lazily by main.tsx only when `window.autosync` is missing.
import type { AutoSyncApi } from '@shared/api'
import type { ActivityEntry, AppStatus, FileChange, FolderStatus, FolderVerdict } from '@shared/types'

const HOST = 'MacBook-Pro'
const OTHER = 'Mac-Studio'
const HOME = '/Users/yasin'
const MIN = 60_000
const HOUR = 60 * MIN
const PAGE = 40

function folder(name: string, dir: string, extra: Partial<FolderStatus>): FolderStatus {
  return {
    id: name,
    path: `${HOME}/${dir}/${name}`,
    name,
    alias: null,
    enabled: true,
    state: 'synced',
    direction: null,
    attention: null,
    branch: 'main',
    remoteUrl: `https://github.com/yaseenarshad/${name}.git`,
    webUrl: `https://github.com/yaseenarshad/${name}`,
    publishVia: 'push',
    pr: null,
    pending: [],
    tooBig: [],
    ignored: { patterns: ['.DS_Store'], count: 3 },
    alsoSyncedBy: null,
    offline: false,
    lastSyncedAt: Date.now() - 5 * MIN,
    lastCheckedAt: Date.now() - 20_000,
    pendingSince: null,
    sendAt: null,
    retryAt: null,
    ...extra,
  }
}

// About a week of bursts from three computers; deterministic so reloads look the same.
function history(now: number): ActivityEntry[] {
  let x = 7
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647
  const files = [
    'stripe-billing/SKILL.md',
    'linear/SKILL.md',
    'linear/references/api.md',
    'youtube/SKILL.md',
    'braindb/SKILL.md',
    'README.md',
  ]
  const out: ActivityEntry[] = []
  const today = new Date(now).setHours(0, 0, 0, 0)
  for (let d = 0; d < 9; d++) {
    for (let k = 0, sessions = 1 + Math.floor(rnd() * 3); k < sessions; k++) {
      const r = rnd()
      const host = r < 0.6 ? HOST : r < 0.85 ? OTHER : 'MacBook-Air'
      let t = Math.min(today - d * 24 * HOUR + (8 + rnd() * 14) * HOUR, now - (0.3 + rnd() * 6) * HOUR)
      for (let i = 0, n = 2 + Math.floor(rnd() * 13); i < n; i++) {
        const paths = new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => files[Math.floor(rnd() * files.length)]))
        const changed = [...paths].map((path): FileChange => ({ status: rnd() < 0.85 ? 'M' : 'A', path }))
        const sha = Array.from({ length: 5 }, () =>
          Math.floor(rnd() * 0xffffffff)
            .toString(16)
            .padStart(8, '0'),
        ).join('')
        const kind = host === HOST ? 'sent' : 'received'
        out.push({ sha, time: t, kind, host, subject: `sync (${host}): ${[...paths].join(', ')}`, files: changed })
        t -= (2 + rnd() * 5) * MIN
      }
    }
  }
  return out
}

export function createFakeApi(): AutoSyncApi {
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const conflicts = [
    { original: 'stripe-billing/SKILL.md', copy: `stripe-billing/SKILL (conflict ${HOST}, ${today}).md` },
    { original: 'linear/references/api.md', copy: `linear/references/api (conflict ${HOST}, ${today}).md` },
  ]
  let status: AppStatus = {
    hostname: HOST,
    paused: false,
    gitMissing: false,
    launchAtLogin: true,
    theme: 'system',
    folders: [
      folder('skills-global-yaseen', 'Documents/GitHub', {
        state: 'attention',
        attention: { kind: 'conflict', conflicts },
        ignored: { patterns: ['node_modules/', '.venv/', '__pycache__/', '.DS_Store'], count: 1043 },
      }),
      folder('yaseen-docs-vault', 'Documents/GitHub', {
        state: 'attention',
        attention: { kind: 'other-app', detail: 'Docs' },
        alsoSyncedBy: 'Docs',
        lastSyncedAt: now - 2 * MIN,
      }),
      folder('YasinContentForge1', 'Documents/GitHub', { state: 'syncing', direction: 'up' }),
      folder('journal-notes', 'Documents/GitHub', {
        state: 'pending',
        pending: [
          { status: 'M', path: '2026/09/27.md' },
          { status: 'A', path: 'ideas/menu-bar-apps.md' },
          { status: 'D', path: 'scratch.md' },
        ],
        pendingSince: now - 2 * MIN,
        sendAt: now + 23_000,
      }),
      folder('course-media', 'Documents/GitHub', { tooBig: [{ path: 'raw/lesson-04.mov', bytes: 240 * 1024 ** 2 }] }),
      folder('client-wiki', 'Documents/GitHub', {
        state: 'attention',
        attention: { kind: 'auth', detail: "fatal: Authentication failed for 'https://github.com/growprofit/client-wiki.git/'" },
        pending: [{ status: 'M', path: 'clients/acme/onboarding.md' }],
        lastSyncedAt: now - 48 * HOUR,
      }),
      folder('solomon-config', 'yaseen-os', {
        state: 'attention',
        attention: { kind: 'busy-repo', detail: 'rebase' },
        lastSyncedAt: now - 6 * HOUR,
      }),
      // Team repos that require pull requests (D22): one waiting on its PR, one counting down to open one, one whose PR was closed.
      folder('team-handbook', 'Documents/GitHub/team', {
        state: 'pending',
        publishVia: 'pr',
        pr: { number: 12, url: 'https://github.com/yaseenarshad/team-handbook/pull/12' },
        pending: [{ status: 'M', path: 'onboarding/first-week.md' }],
        pendingSince: now - 7 * MIN,
      }),
      folder('team-sops', 'Documents/GitHub/team', {
        state: 'pending',
        publishVia: 'pr',
        pending: [{ status: 'M', path: 'support/refunds.md' }],
        pendingSince: now - 48_000,
        sendAt: now + 4 * MIN + 12_000,
      }),
      folder('team-wiki', 'Documents/GitHub/team', {
        state: 'attention',
        publishVia: 'pr',
        attention: { kind: 'pr-closed', detail: 'https://github.com/yaseenarshad/team-wiki/pull/7' },
        pending: [{ status: 'A', path: 'clients/acme.md' }],
        lastSyncedAt: now - 3 * HOUR,
      }),
      folder('drafts', 'yaseen-os', { enabled: false, state: 'off', lastSyncedAt: now - 9 * 24 * HOUR }),
    ],
  }
  const conflictCommit: ActivityEntry = {
    sha: 'e41c9a2f00d1c0ffee5eed0123456789abcdef01',
    time: now - 4 * MIN,
    kind: 'conflict',
    host: OTHER,
    subject: `sync (${OTHER}): conflict, kept both`,
    files: [
      ...conflicts.map((c): FileChange => ({ status: 'M', path: c.original })),
      ...conflicts.map((c): FileChange => ({ status: 'A', path: c.copy })),
    ],
  }
  const manualCommit: ActivityEntry = {
    sha: '9b0e7d1c2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d',
    time: now - 3 * HOUR,
    kind: 'manual',
    host: 'Yasin Arshad',
    subject: 'Rename skills folder',
    files: [{ status: 'R', path: 'skills/README.md' }],
  }
  const log = new Map<string, ActivityEntry[]>([
    ['skills-global-yaseen', [conflictCommit, ...history(now), manualCommit].sort((a, b) => b.time - a.time)],
  ])
  const statusListeners = new Set<(s: AppStatus) => void>()

  function set(next: AppStatus): Promise<AppStatus> {
    status = next
    for (const l of statusListeners) l(status)
    return Promise.resolve(status)
  }
  const patch = (id: string, change: Partial<FolderStatus>) =>
    set({ ...status, folders: status.folders.map((f) => (f.id === id ? { ...f, ...change } : f)) })

  function verdict(path: string): FolderVerdict {
    if (status.folders.some((f) => f.path === path)) return { ok: false, path, reason: 'already-added' }
    if (/draw/i.test(path)) return { ok: true, path, warning: 'Draw', offline: false }
    if (/local/i.test(path)) return { ok: false, path, reason: 'no-origin' }
    if (/private/i.test(path)) return { ok: false, path, reason: 'auth' }
    if (/downloads/i.test(path)) return { ok: false, path, reason: 'not-git' }
    if (/\/client$/.test(path)) return { ok: false, path, reason: 'not-root', root: path.replace(/\/client$/, '') }
    return { ok: true, path, warning: null, offline: false }
  }

  return {
    getStatus: () => Promise.resolve(status),
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    onNavigate: () => () => {},
    pickFolder: () => Promise.resolve(window.prompt('Folder path (fake picker)', `${HOME}/Documents/GitHub/new-repo`)),
    checkFolder: (path) => Promise.resolve(verdict(path)),
    addFolder(path) {
      const name = path.split('/').pop()!
      return set({
        ...status,
        folders: [...status.folders, folder(name, path.slice(HOME.length + 1, -name.length - 1), { lastSyncedAt: Date.now() })],
      })
    },
    removeFolder: (id) => set({ ...status, folders: status.folders.filter((f) => f.id !== id) }),
    setFolderEnabled: (id, enabled) => patch(id, { enabled, state: enabled ? 'synced' : 'off' }),
    setPaused: (paused) => set({ ...status, paused }),
    async syncNow(id) {
      for (const f of status.folders.filter((f) => (id === null || f.id === id) && f.enabled)) {
        await patch(f.id, { state: 'syncing', direction: f.pending.length ? 'up' : 'down' })
        setTimeout(
          () => patch(f.id, { state: 'synced', direction: null, attention: null, pr: null, pending: [], sendAt: null, lastSyncedAt: Date.now() }),
          1500,
        )
      }
    },
    async resendPullRequest(id) {
      await patch(id, { state: 'syncing', direction: 'up', attention: null })
      setTimeout(() => patch(id, { state: 'pending', direction: null, pr: { number: 8, url: `https://github.com/yaseenarshad/${id}/pull/8` } }), 1500)
    },
    activity(id, cursor = 0) {
      const all = log.get(id) ?? []
      const next = cursor + PAGE
      return Promise.resolve({ entries: all.slice(cursor, next), cursor: next < all.length ? next : null })
    },
    setLaunchAtLogin: (on) => set({ ...status, launchAtLogin: on }),
    // The CSS follows prefers-color-scheme, which only Electron's themeSource can move: the browser preview just records it.
    setTheme: (theme) => set({ ...status, theme }),
    showFolderMenu: async (id) => console.info('showFolderMenu (native in Electron)', id),
    // Fake ids are the folder names.
    setAlias: (id, alias) => patch(id, { alias, name: alias ?? id }),
    openInTerminal: async (id) => console.info('openInTerminal', id),
    openInEditor: async (id) => console.info('openInEditor', id),
    showInFinder: async (id) => console.info('showInFinder', id),
    openExternal: async (url) => void window.open(url, '_blank'),
    copyText: (text) => navigator.clipboard.writeText(text),
  }
}
