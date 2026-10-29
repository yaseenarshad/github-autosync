import type { AppStatus, FolderStatus, PullEvery, PushEvery, RepoSettings, SyncState } from './types'

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
/** A folder that ended level pulls again this often (the default pull, D39). */
export const POLL_MS = 60_000
/** The unit of the per-repo push and pull settings (D37, D39). */
export const MINUTE_MS = 60_000
/** D38: Auto never waits longer than this after the first unsent change… */
export const AUTO_CAP_MS = 5 * MINUTE_MS
/** …nor, in PR mode, longer than this. */
export const PR_CAP_MS = 30 * MINUTE_MS
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

// ---------- per-repo settings (D34, D37, D39) ----------

/** A repo nobody has set up yet behaves exactly as before: send 30 s after edits, pull every minute, the whole repo. */
export const DEFAULT_SETTINGS: RepoSettings = { push: 'auto', pull: 1, paths: null, beforePush: null }

/** The push choices the window offers, in order (D37). Minutes in between. */
export const PUSH_CHOICES: readonly PushEvery[] = ['auto', 5, 15, 30, 60, 240, 'manual']
/** The pull choices the window offers, in order (D39). */
export const PULL_CHOICES: readonly PullEvery[] = [1, 5, 15, 60, 'manual']

/** `5 min`, `1 hour`, `4 hours`. */
export const minutesLabel = (m: number): string => (m % 60 === 0 ? plural(m / 60, 'hour') : `${m} min`)

export const pushLabel = (p: PushEvery): string => (p === 'auto' ? `Auto (${DEBOUNCE_MS / 1000}s after edits)` : p === 'manual' ? 'By hand only' : `Every ${minutesLabel(p)}`)
/** D52: the pull in a sentence — "checks GitHub every minute". */
export const checksEvery = (p: PullEvery): string => (p === 'manual' ? 'only when you press Sync now' : p === 1 ? 'every minute' : `every ${minutesLabel(p)}`)

export const pullLabel = (p: PullEvery): string => (p === 'manual' ? 'By hand only' : p === 1 ? 'Every minute' : `Every ${minutesLabel(p)}`)

/** D44: the folders a commit may take; null is the whole repo. */
export type Picks = readonly string[] | null

/** D44: a repo-relative path inside the picks (a picked folder covers everything below it). */
export const inPicks = (picks: Picks, rel: string): boolean => picks === null || picks.some((p) => rel === p || rel.startsWith(`${p}/`))

/** D51: the pauses for a while that the folder menu and the folder page offer. */
export const PAUSES: ReadonlyArray<readonly [number, string]> = [
  [60, 'Pause for 1 hour'],
  [240, 'Pause for 4 hours'],
]

// ---------- links ----------

/** The one site the app opens in a browser (`openExternal`) — so also the only URLs the window renders as links. */
export const isGitHubUrl = (url: string): boolean => url.startsWith('https://github.com/')

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
