import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { OtherRepo } from '@shared/types'
import { findGit, git } from './git/exec'
import { isRepoRoot, repoKey } from './git/detect'
import { TRANSFER_TIMEOUT_MS } from './git/pass'
import { keyOf, type Config } from './registry'
import type { MacFile } from './settingsFolder'

/**
 * D53, D54: the repos another computer syncs and this one does not have. Read from the settings
 * folder's other files; nothing turns on before the user clicks Add or Clone.
 */

/** A home folder at the start of a path, on any OS another computer may run. */
const HOME_AT_START = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/

/** D53: another computer's path with its home folder swapped for this one's — where a clone most likely is. */
export function onThisComputer(otherPath: string, home: string): string {
  const swapped = otherPath.replace(HOME_AT_START, home)
  // A Windows path read on a Mac (or the reverse) keeps its own separators otherwise.
  return path.join(...swapped.split(/[/\\]/).map((seg, i) => (i === 0 && seg === '' ? path.sep : seg)))
}

/** The repos the other files list as syncing that this computer has no folder for, grouped by key. */
export function othersFrom(config: Config, files: readonly MacFile[], home: string): OtherRepo[] {
  const mine = new Set(config.folders.map(keyOf).filter((k): k is string => k !== null))
  const out = new Map<string, OtherRepo>()
  for (const file of files) {
    for (const [key, repo] of Object.entries(file.repos)) {
      if (!repo.syncing || mine.has(key)) continue
      const seen = out.get(key)
      if (seen !== undefined) {
        if (!seen.computers.includes(file.name)) seen.computers.push(file.name)
        continue
      }
      const where = onThisComputer(repo.path, home)
      out.set(key, {
        key,
        name: path.basename(where),
        remoteUrl: repo.remoteUrl,
        computers: [file.name],
        expectedPath: where,
        found: null,
        cloning: false,
        error: null,
        hidden: config.hiddenRepos.includes(key),
      })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The key of the repo at `dir`, or null when it is not the top of a repo with an origin. */
async function keyAt(bin: string, dir: string): Promise<string | null> {
  if (!isRepoRoot(dir)) return null
  const origin = await git(bin, dir, ['remote', 'get-url', 'origin'])
  return origin.code === 0 ? repoKey(origin.stdout.trim()) : null
}

/**
 * D53: where each repo is on this computer, if anywhere: the other computer's path with the home
 * folder swapped, else a folder beside this computer's synced folders (one level). Runs when the
 * window opens and when a settings file changes, never on a timer.
 */
export async function findClones(others: readonly OtherRepo[], config: Config): Promise<OtherRepo[]> {
  const bin = await findGit()
  if (bin === null || others.length === 0) return [...others]
  const wanted = new Set(others.map((o) => o.key))
  const nearby = new Map<string, string>()
  const parents = [...new Set(config.folders.map((f) => path.dirname(f.path)))]
  for (const parent of parents) {
    const names = await readdir(parent, { withFileTypes: true }).catch(() => [])
    for (const d of names) {
      if (!d.isDirectory()) continue
      const dir = path.join(parent, d.name)
      const key = await keyAt(bin, dir)
      if (key !== null && wanted.has(key) && !nearby.has(key)) nearby.set(key, dir)
    }
  }
  const out: OtherRepo[] = []
  for (const o of others) {
    const found = (await keyAt(bin, o.expectedPath)) === o.key ? o.expectedPath : (nearby.get(o.key) ?? null)
    out.push({ ...o, found })
  }
  return out
}

/**
 * D54: `git clone` into `<parent>/<name>`. A folder that is already there stops it before git runs;
 * a clone that fails removes only the folder it made. Answers the new folder, or an error in words.
 */
export async function cloneInto(remoteUrl: string, parent: string, name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const target = path.join(parent, name)
  if (existsSync(target)) return { ok: false, error: `${parent} already has a folder named ${name}. Pick a different folder, or Add the one that is there.` }
  const bin = await findGit()
  if (bin === null) return { ok: false, error: 'git is not installed on this computer.' }
  const cloned = await git(bin, parent, ['clone', '--quiet', '--', remoteUrl, name], { timeoutMs: TRANSFER_TIMEOUT_MS })
  if (cloned.code === 0) return { ok: true, path: target }
  await rm(target, { recursive: true, force: true }).catch(() => undefined)
  const line = `${cloned.stderr}`.split('\n').find((l) => /fatal:|error:/.test(l)) ?? cloned.stderr.trim()
  return { ok: false, error: line === '' ? 'git clone failed.' : line }
}
