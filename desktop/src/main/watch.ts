import { watch } from 'chokidar'
import path from 'node:path'

/** Git's own bookkeeping, and the one folder that is huge, churns constantly and is (almost) always ignored. */
const SKIPPED = new Set(['.git', 'node_modules'])

/**
 * D3: any change under a synced folder is a trigger. What counts as a change worth committing is
 * git's call (`.gitignore`), not ours — so the only filter here is what would flood the watcher.
 * Errors (a folder removed while watched) are swallowed: the next pass reports the folder itself.
 */
export function watchFolder(root: string, onEvent: () => void): () => void {
  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (p) => path.relative(root, p).split(path.sep).some((seg) => SKIPPED.has(seg)),
  })
  watcher.on('all', () => onEvent())
  watcher.on('error', () => undefined)
  return () => void watcher.close()
}
