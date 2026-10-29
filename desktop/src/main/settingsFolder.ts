import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/status'
import type { RepoSettings } from '@shared/types'
import { keyOf, readSettings, withRepoSettings, type Config, type Registry } from './registry'

/**
 * THE SETTINGS FOLDER (D35, D36), after the docs app's (`yaseen-docs-app` YAZ-3276): keeps the
 * registry's `repos` and the chosen folder the same, both ways, while `settingsFolder` names one.
 *
 *  - OUT. Each computer writes only `settings-<macId>.json`, so git never has two writers on one
 *    file. It lists every repo this computer has, where, whether it syncs it, and its settings with
 *    their `savedAt`. The same text as the last write is skipped: git gets no empty commit.
 *  - IN. One watch on the folder (depth 0). The other computers' files are read; for each repo the
 *    newest `savedAt` wins — per repo, not per file, so changes to two repos on two computers both
 *    stay. A file that will not parse (half synced) is skipped; its next change reads it again.
 *  - MISSING. A read or write that fails marks the folder missing; the registry keeps its copy and
 *    one timer reads again every `retryMs` until it works.
 *  - MISSED. A folder watch can miss a save (macOS drops events for a watch that just started, and
 *    git rewrites files under it on a pull), so the folder is also read every `rereadMs`: one
 *    `readdir` and a few small files.
 *
 * Electron-free: the host name comes in, so tests run two "computers" on one folder.
 */

/** `settings-<12 of [0-9a-z]>.json` only: a copy (`settings-x 2.json`) or a conflict copy never counts. */
export const SETTINGS_FILE = /^settings-[0-9a-z]{12}\.json$/

export const settingsFileName = (macId: string): string => `settings-${macId}.json`

/** One repo as one computer reports it (D36). */
export interface MacRepo {
  remoteUrl: string
  /** Where that computer keeps it. */
  path: string
  /** On and syncing there. */
  syncing: boolean
  savedAt: number
  /** For showing (D53): each field this build cannot read is the default. */
  settings: RepoSettings
  /** As read from another computer's file, for taking it (D36): a field this build cannot read keeps this computer's value. */
  raw?: unknown
}

/** Another computer's file. */
export interface MacFile {
  macId: string
  /** Its host name, for people; the rules never use it. */
  name: string
  /** When it last saved (item 18); 0 when the file does not say. */
  savedAt: number
  repos: Record<string, MacRepo>
}

export interface SettingsFolder {
  /** The first read; done at once with no folder. */
  ready: Promise<void>
  /** True while the chosen folder cannot be read or written. Always false with no folder. */
  missing(): boolean
  /** The other computers' files as last read (D53). */
  others(): readonly MacFile[]
  /** The registry changed: follow a new folder, and write this computer's file soon. */
  changed(): void
  /** Every read and write asked for so far is done. */
  settled(): Promise<void>
  /** The pending write, at once (quit). */
  flush(): Promise<void>
  close(): Promise<void>
}

export interface SettingsFolderDeps {
  host: string
  /** Something the window shows changed: settings taken from another computer, the others list, missing. */
  onChange: () => void
  debounceMs?: number
  retryMs?: number
  rereadMs?: number
}

/** A burst of registry changes is one file write. */
const WRITE_DEBOUNCE_MS = 150
/** While the folder is missing, a read this often: one `readdir`, so 5 s costs nothing. */
const RETRY_MS = 5000
/** The safety read for a missed event. */
const REREAD_MS = 30_000

/** This computer's file: the pretty text, so the same config always gives the same text. */
export function settingsFileText(config: Config, host: string): string {
  const repos: Record<string, MacRepo> = {}
  for (const folder of config.folders) {
    const key = keyOf(folder)
    if (key === null || folder.remote === undefined) continue
    const stored = config.repos[key]
    repos[key] = { remoteUrl: folder.remote, path: folder.path, syncing: folder.enabled, savedAt: stored?.savedAt ?? 0, settings: stored?.settings ?? DEFAULT_SETTINGS }
  }
  const savedAt = Math.max(0, ...Object.values(repos).map((r) => r.savedAt))
  return `${JSON.stringify({ name: host, savedAt, repos }, null, 2)}\n`
}

/** A file's text as a file, or null when it is not one. Each repo is read field by field (`readSettings`). */
export function parseSettingsFile(macId: string, text: string): MacFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const v = raw as { name?: unknown; savedAt?: unknown; repos?: unknown } | null
  if (v === null || typeof v !== 'object' || v.repos === null || typeof v.repos !== 'object') return null
  const repos: Record<string, MacRepo> = {}
  for (const [key, entry] of Object.entries(v.repos as Record<string, unknown>)) {
    const r = entry as Partial<Record<keyof MacRepo, unknown>> | null
    if (r === null || typeof r !== 'object' || typeof r.remoteUrl !== 'string' || typeof r.path !== 'string' || typeof r.savedAt !== 'number' || !Number.isFinite(r.savedAt)) continue
    repos[key] = { remoteUrl: r.remoteUrl, path: r.path, syncing: r.syncing === true, savedAt: r.savedAt, settings: readSettings(r.settings, DEFAULT_SETTINGS), raw: r.settings }
  }
  return { macId, name: typeof v.name === 'string' ? v.name : '', savedAt: typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0, repos }
}

/**
 * The registry with every repo the other computers saved more recently than this one (D35). A field
 * one of them could not say keeps this computer's value. Null when nothing is newer.
 */
export function takeNewer(config: Config, files: readonly MacFile[]): Config | null {
  let next = config
  for (const file of files) {
    for (const [key, theirs] of Object.entries(file.repos)) {
      const ours = next.repos[key]
      if (theirs.savedAt <= (ours?.savedAt ?? 0)) continue
      next = withRepoSettings(next, key, readSettings(theirs.raw ?? theirs.settings, ours?.settings ?? DEFAULT_SETTINGS), theirs.savedAt)
    }
  }
  return next === config ? null : next
}

export function followSettingsFolder(registry: Registry, deps: SettingsFolderDeps): SettingsFolder {
  let folder = registry.get().settingsFolder
  let watcher: FSWatcher | null = null
  let missing = false
  let files: MacFile[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let readSoon: ReturnType<typeof setTimeout> | null = null
  const reread = setInterval(() => {
    if (folder !== null && !missing) void run(pull)
  }, deps.rereadMs ?? REREAD_MS)
  reread.unref()
  /** The text of this computer's last write to `folder`; null after a re-point, so the new folder gets a file. */
  let lastText: string | null = null
  let closed = false
  /** Reads and writes in order, so a write never races a read of the same folder. */
  let chain: Promise<void> = Promise.resolve()

  const own = (): string => settingsFileName(registry.get().macId)

  const run = (work: () => Promise<void>): Promise<void> =>
    (chain = chain.then(work).then(
      () => {
        if (missing) {
          missing = false
          deps.onChange()
        }
      },
      (err: unknown) => {
        const was = missing
        missing = folder !== null
        console.warn(`[settings] the settings folder ${folder ?? ''} could not be used: ${String(err)}`)
        if (missing !== was) deps.onChange()
        if (missing && retry === null && !closed) {
          retry = setTimeout(() => {
            retry = null
            void point()
          }, deps.retryMs ?? RETRY_MS)
        }
      },
    ))

  async function push(): Promise<void> {
    const dir = folder
    if (dir === null) return
    const text = settingsFileText(registry.get(), deps.host)
    if (text === lastText) return
    const file = path.join(dir, own())
    const tmp = `${file}.tmp`
    await writeFile(tmp, text)
    await rename(tmp, file)
    lastText = text
  }

  async function pull(): Promise<void> {
    const dir = folder
    if (dir === null) return
    const names = (await readdir(dir)).filter((name) => SETTINGS_FILE.test(name) && name !== own())
    const read = await Promise.all(names.map((name) => readFile(path.join(dir, name), 'utf8').then((text) => parseSettingsFile(name.slice('settings-'.length, -'.json'.length), text), () => null)))
    const fresh = read.filter((f): f is MacFile => f !== null)
    // The safety read finds the same files nearly every time: only news reaches the app (it starts a clone search, D53).
    const same = JSON.stringify(fresh) === JSON.stringify(files)
    files = fresh
    const next = takeNewer(registry.get(), files)
    if (next !== null) registry.update(() => next)
    if (!same || next !== null) deps.onChange()
    // Taking a newer repo, or a folder this computer has never written to, both leave this file behind.
    await push()
  }

  /** (Re)starts the watch on `folder` and reads it. */
  function point(): Promise<void> {
    watcher?.close()
    watcher = null
    if (folder === null) {
      files = []
      deps.onChange()
      return chain
    }
    const dir = folder
    try {
      watcher = watch(dir, (_event, name) => {
        // Only its own writes are skipped: another computer's save can arrive as its temp file's name
        // (write, then rename), and one `readdir` of a small folder costs nothing.
        if (name !== null && (name === own() || name === `${own()}.tmp`)) return
        if (readSoon !== null) clearTimeout(readSoon)
        readSoon = setTimeout(() => {
          readSoon = null
          void run(pull)
        }, deps.debounceMs ?? WRITE_DEBOUNCE_MS)
      })
      watcher.on('error', () => undefined)
    } catch {
      // Not there yet: the read fails too, and the retry watches it once it exists.
    }
    return run(pull)
  }

  return {
    ready: point(),
    missing: () => missing,
    others: () => files,
    changed() {
      const next = registry.get().settingsFolder
      if (next !== folder) {
        folder = next
        lastText = null
        missing = false
        if (retry !== null) clearTimeout(retry)
        retry = null
        void point()
        return
      }
      if (folder === null) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run(push)
      }, deps.debounceMs ?? WRITE_DEBOUNCE_MS)
    },
    settled: () => chain,
    flush() {
      if (timer === null) return chain
      clearTimeout(timer)
      timer = null
      return run(push)
    },
    async close() {
      closed = true
      clearInterval(reread)
      for (const t of [timer, retry, readSoon]) if (t !== null) clearTimeout(t)
      timer = retry = readSoon = null
      watcher?.close()
      watcher = null
      await chain
    },
  }
}
