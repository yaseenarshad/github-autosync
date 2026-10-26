import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { PEEK_MS } from '@shared/status'
import { findGit, git, zList } from './git/exec'

/** Git's own bookkeeping, and node_modules: skipped even when git cannot list what it ignores. */
const SKIPPED = new Set(['.git', 'node_modules'])

/** Writes inside `.git` that change what git ignores: a file tracked by force (`git add -f`), or the repo's own excludes. */
const RULES_IN_GIT = new Set(['.git/index', '.git/info/exclude'])

/**
 * What git ignores right now (D9), relative and `/`-separated. `--ignored=matching` names a folder
 * only when a pattern matches it: a folder whose files just happen to be ignored (only a Finder
 * `.DS_Store`) comes as those files, so a real file saved there still wakes the folder. Tracked files
 * are never listed. Null when git cannot say: then only SKIPPED is skipped.
 */
async function readIgnored(root: string): Promise<Set<string> | null> {
  const bin = await findGit()
  if (bin === null) return null
  const res = await git(bin, root, ['status', '--porcelain', '-z', '--ignored=matching', '--untracked-files=normal']).catch(() => null)
  if (res?.code !== 0) return null
  const out = new Set<string>()
  const tokens = zList(res)
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i] ?? ''
    if (entry.startsWith('!! ')) out.add(entry.slice(3).replace(/\/$/, ''))
    else if (entry.charAt(0) === 'R' || entry.charAt(0) === 'C') i += 1 // `-z` puts the rename's old path in the next token
  }
  return out
}

/**
 * D3: any change under a synced folder is a trigger, except under what git ignores (D33).
 * One recursive OS watch covers the folder (FSEvents on macOS, ReadDirectoryChangesW on Windows),
 * so its cost does not grow with the files in it: chokidar 4 held one watch per path, 2.6 GB on a
 * repo with three `.venv`s. Events under ignored paths still arrive; a set lookup drops them.
 * Git's list is read at the start, and again at most once per `PEEK_MS` after a path is created,
 * renamed or deleted, a `.gitignore`, `.git/index` or `.git/info/exclude` changes, or any event
 * while the last read failed. Each read replaces the list. Until the first read, events go through.
 * Errors (a folder removed while watched) are swallowed: the next pass reports the folder itself.
 */
export function watchFolder(root: string, onEvent: () => void): () => void {
  let ignored = new Set<string>()
  let stale = true
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let reading = false
  let again = false

  const isIgnored = (rel: string): boolean => {
    const segs = rel.split('/')
    if (segs.some((seg) => SKIPPED.has(seg))) return true
    for (let i = 1; i <= segs.length; i += 1) if (ignored.has(segs.slice(0, i).join('/'))) return true
    return false
  }

  function reread(): void {
    again = true
    if (timer === null && !reading) timer = setTimeout(() => void refresh(), PEEK_MS)
  }

  async function refresh(): Promise<void> {
    timer = null
    reading = true
    again = false
    const next = await readIgnored(root)
    reading = false
    if (closed) return
    stale = next === null
    if (next !== null) ignored = next
    if (again) reread()
  }

  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (event, name) => {
      if (closed) return
      // No name: the OS dropped the detail. Let it through; the peek's `git status` decides.
      const rel = name === null ? '' : name.split(path.sep).join('/')
      if (RULES_IN_GIT.has(rel)) return reread()
      if (isIgnored(rel)) return
      if (event === 'rename' || stale || path.posix.basename(rel) === '.gitignore') reread()
      onEvent()
    })
  } catch {
    return () => undefined
  }
  watcher.on('error', () => undefined)
  void refresh()
  return () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    watcher.close()
  }
}
