import { randomInt, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/status'
import type { PullEvery, PushEvery, RepoSettings, ThemeChoice } from '@shared/types'
import { repoKey } from './git/detect'
import type { FolderConfig } from './git/manager'

/**
 * D5: the folder list and the app switches, in `<userData>/config.json`. The one file this app
 * owns on its own; the settings folder (D35) is the user's choice and holds a copy of `repos`.
 *
 * Written whole on every change, via temp file + rename, so a crash mid-write leaves the old file
 * rather than half a new one, and only after the change passes the same check a load does. A file that will not parse is moved aside to `config.json.bak`
 * (kept for a human to look at) and the app starts from defaults instead of refusing to start.
 */

/** D35: one repo's settings and when they were last changed, on any computer — the newest wins. */
export interface StoredRepo {
  settings: RepoSettings
  savedAt: number
}

export interface Config {
  version: 1
  folders: FolderConfig[]
  launchAtLogin: boolean
  paused: boolean
  /** D19: Electron's own `themeSource` vocabulary, so applying it is one assignment. */
  theme: ThemeChoice
  /** D35: this computer's name in the settings folder (`settings-<macId>.json`). Made once, never shown. */
  macId: string
  /** D35: where the settings travel; null when none is chosen. */
  settingsFolder: string | null
  /** D34: settings by repo key. A repo with no entry uses `DEFAULT_SETTINGS`. */
  repos: Record<string, StoredRepo>
  /** D53: other computers' repos the user said are not for this computer. */
  hiddenRepos: string[]
}

export interface Registry {
  get(): Config
  /** Applies `change` to a copy and persists it; answers the new config. Throws, writing nothing, if the result is malformed. */
  update(change: (config: Config) => Config): Config
}

/** `settings-<macId>.json` — the shape the docs app uses too (12 of `[0-9a-z]`). */
export const MAC_ID = /^[0-9a-z]{12}$/

const newMacId = (): string => Array.from({ length: 12 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(randomInt(36))).join('')

const defaults = (): Config => ({ version: 1, folders: [], launchAtLogin: true, paused: false, theme: 'system', macId: newMacId(), settingsFolder: null, repos: {}, hiddenRepos: [] })

const THEMES: readonly unknown[] = ['system', 'light', 'dark'] satisfies ThemeChoice[]

/** A day at most: anything longer is a typo, not a cadence. */
const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 24 * 60
const isPush = (v: unknown): v is PushEvery => v === 'auto' || v === 'manual' || isMinutes(v)
const isPull = (v: unknown): v is PullEvery => v === 'manual' || isMinutes(v)
/** D44: a repo-relative folder, `/`-separated, that cannot climb out of the repo. */
export const isRepoPath = (v: unknown): v is string => typeof v === 'string' && v !== '' && !v.startsWith('/') && !v.endsWith('/') && !v.includes('\\') && !v.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
const isPaths = (v: unknown): v is string[] | null => v === null || (Array.isArray(v) && v.length > 0 && v.every(isRepoPath))
const isCommand = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.trim() !== '')

/**
 * One field at a time: a field this build cannot read keeps `fallback`'s value (D36). Used for the
 * other computers' files, which a newer or older build may have written.
 */
export function readSettings(raw: unknown, fallback: RepoSettings): RepoSettings {
  const v = (raw ?? {}) as Partial<Record<keyof RepoSettings, unknown>>
  return {
    push: isPush(v.push) ? v.push : fallback.push,
    pull: isPull(v.pull) ? v.pull : fallback.pull,
    paths: isPaths(v.paths) ? v.paths : fallback.paths,
    beforePush: isCommand(v.beforePush) ? v.beforePush : fallback.beforePush,
  }
}

/** Strict: config.json is this app's own file, so every field must be readable. */
const isSettings = (v: unknown): v is RepoSettings => {
  const s = v as Partial<RepoSettings> | null
  return s !== null && typeof s === 'object' && isPush(s.push) && isPull(s.pull) && isPaths(s.paths) && isCommand(s.beforePush)
}

const isStoredRepo = (v: unknown): v is StoredRepo => {
  const r = v as Partial<StoredRepo> | null
  return r !== null && typeof r === 'object' && isSettings(r.settings) && typeof r.savedAt === 'number' && Number.isFinite(r.savedAt)
}

const optional = (v: unknown, test: (v: unknown) => boolean): boolean => v === undefined || test(v)

const isFolder = (v: unknown): v is FolderConfig => {
  const f = v as Partial<FolderConfig> | null
  return (
    typeof f?.id === 'string' &&
    typeof f.path === 'string' &&
    typeof f.enabled === 'boolean' &&
    optional(f.alias, (a) => typeof a === 'string') &&
    optional(f.remote, (r) => typeof r === 'string' && r !== '') &&
    optional(f.pausedUntil, (t) => typeof t === 'number' && Number.isFinite(t))
  )
}

/** Only the keys config.json stores: the manager's runtime fields (`settings`) never reach the disk. */
const storedFolder = ({ id, path: p, enabled, alias, remote, pausedUntil }: FolderConfig): FolderConfig => ({
  id,
  path: p,
  enabled,
  ...(alias === undefined ? {} : { alias }),
  ...(remote === undefined ? {} : { remote }),
  ...(pausedUntil === undefined ? {} : { pausedUntil }),
})

function parse(raw: string): Config | null {
  try {
    const v = JSON.parse(raw) as Partial<Config> | null
    if (v?.version !== 1 || !Array.isArray(v.folders) || !v.folders.every(isFolder) || typeof v.launchAtLogin !== 'boolean' || typeof v.paused !== 'boolean') return null
    // Fields that arrived after the first configs were written: absent means the default, anything else unknown is malformed.
    if (v.theme !== undefined && !THEMES.includes(v.theme)) return null
    if (!optional(v.settingsFolder, (f) => f === null || (typeof f === 'string' && path.isAbsolute(f)))) return null
    if (!optional(v.repos, (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every(isStoredRepo))) return null
    if (!optional(v.hiddenRepos, (h) => Array.isArray(h) && h.every((k) => typeof k === 'string'))) return null
    return {
      version: 1,
      folders: v.folders.map(storedFolder),
      launchAtLogin: v.launchAtLogin,
      paused: v.paused,
      theme: v.theme ?? 'system',
      // A config from before D35 gets its id here; it is written with the next change.
      macId: typeof v.macId === 'string' && MAC_ID.test(v.macId) ? v.macId : newMacId(),
      settingsFolder: v.settingsFolder ?? null,
      repos: v.repos ?? {},
      hiddenRepos: v.hiddenRepos ?? [],
    }
  } catch {
    return null
  }
}

export function createRegistry(dir: string): Registry {
  const file = path.join(dir, 'config.json')
  let config = defaults()
  if (existsSync(file)) {
    const loaded = parse(readFileSync(file, 'utf8'))
    if (loaded === null) renameSync(file, `${file}.bak`)
    else config = loaded
  }

  return {
    get: () => config,
    update(change) {
      // Held to the same rules as a load: a value the next launch would reject never reaches the disk.
      const next = parse(JSON.stringify(change(structuredClone(config))))
      if (next === null) throw new Error('Refusing to save a malformed config')
      mkdirSync(dir, { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
      renameSync(tmp, file)
      config = next
      return config
    },
  }
}

/** A folder as it enters the list: a stable random id, syncing from the start. */
export const newFolder = (folderPath: string, remote?: string): FolderConfig => ({ id: randomUUID(), path: folderPath, enabled: true, ...(remote === undefined ? {} : { remote }) })

/** D18: a nickname is trimmed, and a blank one is no nickname — the key is dropped rather than stored empty. */
export function withAlias(folder: FolderConfig, alias: string | null): FolderConfig {
  const { alias: _old, ...rest } = folder
  const trimmed = alias?.trim() ?? ''
  return trimmed === '' ? rest : { ...rest, alias: trimmed }
}

/** D34: a folder's key, once its origin is known. */
export const keyOf = (folder: FolderConfig): string | null => (folder.remote === undefined ? null : repoKey(folder.remote))

/** D34: the settings a folder runs with — its repo's, or the defaults. */
export function settingsOf(config: Config, folder: FolderConfig): RepoSettings {
  const key = keyOf(folder)
  return (key === null ? undefined : config.repos[key]?.settings) ?? DEFAULT_SETTINGS
}

/**
 * D34: each folder's origin as a pass last read it. A repo renamed on GitHub (or moved to a new
 * owner) gets a new key; its settings move with it, so nothing resets. Null when nothing changed.
 */
export function withLearnedRemotes(config: Config, seen: ReadonlyMap<string, string | null>): Config | null {
  let repos = config.repos
  let changed = false
  const folders = config.folders.map((f) => {
    const remote = seen.get(f.id) ?? null
    if (remote === null || remote === f.remote) return f
    changed = true
    const before = keyOf(f)
    const after = repoKey(remote)
    const moving = before === null || before === after ? undefined : repos[before]
    if (moving !== undefined && (repos[after]?.savedAt ?? -1) < moving.savedAt) repos = { ...repos, [after]: moving }
    return { ...f, remote }
  })
  return changed ? { ...config, folders, repos } : null
}

/** D35: a change made on this computer is the newest, so it is stamped now. */
export function withRepoSettings(config: Config, key: string, settings: RepoSettings, savedAt = Date.now()): Config {
  return { ...config, repos: { ...config.repos, [key]: { settings, savedAt } } }
}
