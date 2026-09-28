// The renderer ↔ main contract (YAZ-1998). Every shape the window and the menu bar render comes from here.
// Decisions referenced as Dn live as comments on YAZ-1998.

/** `off` = folder disabled or app paused (`AppStatus.paused` says which). */
export type SyncState = 'off' | 'synced' | 'pending' | 'syncing' | 'attention'

/**
 * Why a folder needs the user. `conflict` does NOT stop syncing (D6 keep-both); every other kind does.
 * `busy-repo` = mid-rebase, mid-merge or detached HEAD — AutoSync never touches it (D16).
 */
export type AttentionKind = 'conflict' | 'auth' | 'no-git' | 'no-identity' | 'busy-repo' | 'error'

/** Repo-relative paths: the original file and the `<name> (conflict <host>, <YYYY-MM-DD>)<ext>` copy beside it. */
export interface ConflictPair {
  original: string
  copy: string
}

export interface Attention {
  kind: AttentionKind
  /** git's first `fatal:`/`error:` line for `error`/`auth`; `rebase` | `merge` | `detached` for `busy-repo`. */
  detail?: string
  conflicts?: ConflictPair[]
}

export type FileStatus = 'M' | 'A' | 'D' | 'R'

export interface FileChange {
  status: FileStatus
  path: string
}

export interface TooBigFile {
  path: string
  bytes: number
}

export type OtherApp = 'Docs' | 'Draw'

export interface FolderStatus {
  id: string
  /** Absolute path on this computer. */
  path: string
  name: string
  enabled: boolean
  state: SyncState
  /** Set while `state === 'syncing'`: sending local commits vs. receiving the other computers'. */
  direction: 'up' | 'down' | null
  attention: Attention | null
  branch: string | null
  /** `origin` URL exactly as configured. */
  remoteUrl: string | null
  /** `https://github.com/<owner>/<repo>` when origin is GitHub, else null. */
  webUrl: string | null
  /** Changes on this computer that are not on GitHub yet: uncommitted + committed-but-unpushed. */
  pending: FileChange[]
  /** Never staged: ≥ 95 MiB (D11). */
  tooBig: TooBigFile[]
  /** Top-level `.gitignore` patterns and how many files git currently ignores (D10). */
  ignored: { patterns: string[]; count: number }
  /** The Docs/Draw app has its own sync switched on for this folder (D2) — warn only. */
  alsoSyncedBy: OtherApp | null
  offline: boolean
  /** Last pass that ended level with origin. */
  lastSyncedAt: number | null
  /** Last successful `git fetch`. */
  lastCheckedAt: number | null
  /** When the current run of unsent changes began (pending > 1 h notifies once, D7). */
  pendingSince: number | null
  /** When the 30 s debounce fires (D3) — drives "Sends in 0:23". */
  sendAt: number | null
  /** When the single offline retry fires (D3). */
  retryAt: number | null
}

export interface AppStatus {
  folders: FolderStatus[]
  paused: boolean
  gitMissing: boolean
  /** This computer's name as used in commit messages and conflict copies (D16). */
  hostname: string
  launchAtLogin: boolean
}

/** D10: the Activity log is read from git history only. */
export type ActivityKind = 'sent' | 'received' | 'conflict' | 'manual'

export interface ActivityEntry {
  sha: string
  /** ms epoch (commit time). */
  time: number
  kind: ActivityKind
  /** Hostname from `sync (<host>): …`, or the author name for a manual commit. */
  host: string
  subject: string
  files: FileChange[]
}

export interface ActivityPage {
  entries: ActivityEntry[]
  /** Pass back to fetch the next (older) page; null when history is exhausted. */
  cursor: number | null
}

export type FolderRejection = 'no-git' | 'not-git' | 'not-root' | 'already-added' | 'no-origin' | 'auth'

/** Add-folder validation (D12, D2). */
export type FolderVerdict =
  | { ok: true; path: string; warning: OtherApp | null; offline: boolean }
  | { ok: false; path: string; reason: FolderRejection; /** repo root when `not-root` */ root?: string }

/** Where a menu bar / notification click wants the window to go. */
export interface NavTarget {
  folderId: string | null
  sheet?: 'settings' | 'pause' | 'resume'
}
