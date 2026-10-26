import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'
import { PEEK_MS } from '@shared/status'
import { findGit, git, zList } from './git/exec'

/** Git's own bookkeeping, and node_modules: skipped even when git cannot list what it ignores. */
const SKIPPED = new Set(['.git', 'node_modules'])

/**
 * What git ignores right now (D9), relative and `/`-separated: a wholly ignored folder once
 * (`--directory`), other ignored files one by one. Tracked files are never listed, so a force-added
 * file stays watched. Null when git cannot say: then only SKIPPED is skipped.
 */
async function readIgnored(root: string): Promise<Set<string> | null> {
  const bin = await findGit()
  if (bin === null) return null
  const res = await git(bin, root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']).catch(() => null)
  return res?.code === 0 ? new Set(zList(res).map((p) => p.replace(/\/$/, ''))) : null
}

/** Every path the watcher holds at or under `rels`: unwatching a folder alone leaves its files' watches open. */
function heldUnder(w: FSWatcher, root: string, rels: readonly string[]): string[] {
  const tops = rels.map((r) => path.join(root, r))
  const out = new Set(tops)
  for (const [dir, names] of Object.entries(w.getWatched())) {
    for (const name of names) {
      const full = path.join(dir, name)
      if (tops.some((t) => full === t || full.startsWith(t + path.sep))) out.add(full)
    }
  }
  return [...out]
}

/**
 * D3: any change under a synced folder is a trigger, except under what git ignores (D33). A `.venv`,
 * a build folder or a database side file then never wakes the folder, and holds no OS watch.
 * Git's list is read before the first scan, and again at most once per `PEEK_MS`: after a new path
 * appears (the list only grows, and what it adds is unwatched) or a `.gitignore` changes (the list is
 * replaced; if a path is no longer ignored, the watcher scans afresh). `.git/info/exclude` and the
 * global excludes file apply from the next start or off/on.
 * Errors (a folder removed while watched) are swallowed: the next pass reports the folder itself.
 */
export function watchFolder(root: string, onEvent: () => void): () => void {
  let ignored = new Set<string>()
  let watcher: FSWatcher | null = null
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let reading = false
  let again = false
  let replace = false

  const isIgnored = (p: string): boolean => {
    const segs = path.relative(root, p).split(path.sep)
    if (segs.some((seg) => SKIPPED.has(seg))) return true
    for (let i = 1; i <= segs.length; i += 1) if (ignored.has(segs.slice(0, i).join('/'))) return true
    return false
  }

  function start(list: Set<string>): void {
    void watcher?.close()
    ignored = list
    const w = watch(root, { ignoreInitial: true, ignored: isIgnored })
    w.on('all', (event, p) => {
      // chokidar asks `ignored` only when it finds a path: one it already watches keeps reporting.
      if (isIgnored(p)) return
      const rules = path.basename(p) === '.gitignore'
      if (rules || event === 'add' || event === 'addDir') reread(rules)
      onEvent()
    })
    w.on('error', () => undefined)
    watcher = w
  }

  function reread(rules: boolean): void {
    replace ||= rules
    again = true
    if (timer === null && !reading) timer = setTimeout(() => void refresh(), PEEK_MS)
  }

  async function refresh(): Promise<void> {
    timer = null
    reading = true
    again = false
    const full = replace
    replace = false
    const next = await readIgnored(root)
    reading = false
    if (closed || watcher === null) return
    if (next === null) replace ||= full
    else if (full && [...ignored].some((p) => !next.has(p))) start(next)
    else {
      const nowIgnored = [...next].filter((p) => !ignored.has(p))
      ignored = new Set([...ignored, ...next])
      if (nowIgnored.length > 0) watcher.unwatch(heldUnder(watcher, root, nowIgnored))
    }
    if (again) reread(false)
  }

  void readIgnored(root).then((first) => {
    if (!closed) start(first ?? new Set())
  })
  return () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    void watcher?.close()
  }
}
