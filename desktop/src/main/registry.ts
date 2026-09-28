import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ThemeChoice } from '@shared/types'
import type { FolderConfig } from './git/manager'

/**
 * D5: the folder list and the two app switches, in `<userData>/config.json`. The one file this app
 * owns; nothing is ever written into the user's folders.
 *
 * Written whole on every change, via temp file + rename, so a crash mid-write leaves the old file
 * rather than half a new one, and only after the change passes the same check a load does. A file that will not parse is moved aside to `config.json.bak`
 * (kept for a human to look at) and the app starts from defaults instead of refusing to start.
 */

export interface Config {
  version: 1
  folders: FolderConfig[]
  launchAtLogin: boolean
  paused: boolean
  /** D19: Electron's own `themeSource` vocabulary, so applying it is one assignment. */
  theme: ThemeChoice
}

export interface Registry {
  get(): Config
  /** Applies `change` to a copy and persists it; answers the new config. Throws, writing nothing, if the result is malformed. */
  update(change: (config: Config) => Config): Config
}

const defaults = (): Config => ({ version: 1, folders: [], launchAtLogin: true, paused: false, theme: 'system' })

const THEMES: readonly unknown[] = ['system', 'light', 'dark'] satisfies ThemeChoice[]

const isFolder = (v: unknown): v is FolderConfig => {
  const f = v as Partial<FolderConfig> | null
  return typeof f?.id === 'string' && typeof f.path === 'string' && typeof f.enabled === 'boolean' && (f.alias === undefined || typeof f.alias === 'string')
}

function parse(raw: string): Config | null {
  try {
    const v = JSON.parse(raw) as Partial<Config> | null
    if (v?.version !== 1 || !Array.isArray(v.folders) || !v.folders.every(isFolder) || typeof v.launchAtLogin !== 'boolean' || typeof v.paused !== 'boolean') return null
    // `theme` arrived after the first configs were written: absent means the default, anything else unknown is malformed.
    if (v.theme !== undefined && !THEMES.includes(v.theme)) return null
    return { version: 1, folders: v.folders, launchAtLogin: v.launchAtLogin, paused: v.paused, theme: v.theme ?? 'system' }
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
export const newFolder = (folderPath: string): FolderConfig => ({ id: randomUUID(), path: folderPath, enabled: true })

/** D18: a nickname is trimmed, and a blank one is no nickname — the key is dropped rather than stored empty. */
export function withAlias(folder: FolderConfig, alias: string | null): FolderConfig {
  const { alias: _old, ...rest } = folder
  const trimmed = alias?.trim() ?? ''
  return trimmed === '' ? rest : { ...rest, alias: trimmed }
}
