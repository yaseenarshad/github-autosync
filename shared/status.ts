import type { AppStatus, FolderStatus, SyncState } from './types'

/**
 * Status rules the window and the menu bar must agree on: the cadence, which state is worst, the
 * one-line summary and how a time reads. Pure, so both sides import it (docs/CONTRACTS.md).
 */

// ---------- cadence (D3) ----------

/** A save is sent this long after the last edit; every later edit pushes it back. */
export const DEBOUNCE_MS = 30_000
/** D24: a PR-mode folder opens its PR this long after the last edit — one PR per sitting, not per save. */
export const PR_QUIET_MS = 5 * 60_000
/** While a batch's PR is open, how often a quiet pass checks whether it merged. */
export const PR_CHECK_MS = 15_000
/** A folder that ended level pulls again this often. */
export const POLL_MS = 60_000
/** After an offline pass, the one quiet retry. */
export const OFFLINE_RETRY_MS = 120_000
/** Wake/unlock pulls, but not again within this of the last pass. */
export const WAKE_COOLDOWN_MS = 10_000
/** A watcher burst settles this long before `git status` says whether anything changed. */
export const PEEK_MS = 1_000
/** Watcher events this soon after a pass are AutoSync's own writes, not edits. */
export const OWN_WRITES_MS = 1_000

/** The cadence as the UI words it, derived from the timers above so the two cannot drift. */
export const SENDS_AFTER = `${DEBOUNCE_MS / 1000}s after you stop editing`
export const OPENS_PR_AFTER = `${PR_QUIET_MS / 60_000} minutes after you stop editing`
export const CHECKS_EVERY = POLL_MS === 60_000 ? 'every minute' : `every ${POLL_MS / 1000}s`

// ---------- worst state ----------

/** Worst first: what needs the user, then what is waiting, then what is moving, then what is fine, then what is off. */
const WORST_FIRST: readonly SyncState[] = ['attention', 'pending', 'syncing', 'synced', 'off']

/** Sort comparator, worst first. */
export const byWorst = (a: SyncState, b: SyncState): number => WORST_FIRST.indexOf(a) - WORST_FIRST.indexOf(b)

// ---------- wording ----------

/** `1 file`, `3 files`; `many` for irregular plurals. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** `3:05 PM` */
export const clock = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** When any folder last ended level with GitHub; null before the first sync. */
export function lastSyncedAt(folders: readonly FolderStatus[]): number | null {
  const times = folders.map((f) => f.lastSyncedAt).filter((t) => t !== null)
  return times.length > 0 ? Math.max(...times) : null
}

/** The one-line summary of every folder: the window's toolbar and "All folders" row, and the menu bar's first line. */
export function headline(status: AppStatus): string {
  const { folders } = status
  if (folders.length === 0) return 'No folders yet'
  if (status.paused) return 'Paused'
  if (status.gitMissing) return 'Git not found'
  const count = (state: SyncState) => folders.filter((f) => f.state === state).length
  const attention = count('attention')
  if (attention > 0) return `${plural(attention, 'folder needs', 'folders need')} you`
  const pending = count('pending')
  if (pending > 0 && folders.some((f) => f.enabled && f.offline)) return 'Offline · changes waiting'
  if (count('syncing') > 0) return 'Syncing…'
  if (pending > 0) return `${pending} waiting to send`
  if (count('off') === folders.length) return 'Sync is off'
  return 'All synced'
}
