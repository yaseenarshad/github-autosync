// The renderer ↔ main contract. Every shape the window and the menu bar render comes from here.
// docs/CONTRACTS.md explains the status model and lists the decisions referenced as Dn.

/** `off` = folder disabled or app paused (`AppStatus.paused` says which). */
export type SyncState = 'off' | 'synced' | 'pending' | 'syncing' | 'attention'

/**
 * Why a folder needs the user. `conflict` does NOT stop syncing (D6 keep-both); every other kind does.
 * `busy-repo` = mid-rebase, mid-merge, detached HEAD, or a side branch of a PR-rule repo — AutoSync never touches it (D16, D29).
 * `no-gh` = the repo needs PRs and `gh` is missing or logged out (D28). `pr-closed` = a human closed the batch's PR (D25).
 * `other-app` = the Docs/Draw app syncs this folder too; AutoSync stands back (D27).
 */
export type AttentionKind = 'conflict' | 'auth' | 'no-git' | 'no-identity' | 'busy-repo' | 'no-gh' | 'pr-closed' | 'other-app' | 'error'

/** Repo-relative paths: the original file and the `<name> (conflict <host>, <YYYY-MM-DD>)<ext>` copy beside it. */
export interface ConflictPair {
  original: string
  copy: string
}

export interface Attention {
  kind: AttentionKind
  /**
   * git's first `fatal:`/`error:` line for `error`/`auth`; `rebase` | `merge` | `detached` | `side-branch` for `busy-repo`;
   * the PR's URL for `pr-closed`; `Docs` | `Draw` for `other-app`; gh's own words for `no-gh`.
   */
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

/** How a folder's changes reach GitHub: straight to the branch, or one PR per batch (D22 — read from the repo's rules). */
export type PublishVia = 'push' | 'pr'

/** The batch in flight: its PR, until the repo's Action merges it (D23, D26). */
export interface PullRequestRef {
  number: number
  url: string
}

export interface FolderStatus {
  id: string
  /** Absolute path on this computer. */
  path: string
  /** Display name: the nickname when set, else the folder's own name. */
  name: string
  /** "Rename in AutoSync…" nickname (D18); never renames anything on disk. */
  alias: string | null
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
  /** `push` until the repo's rules are known to require PRs on this branch (D22). */
  publishVia: PublishVia
  /** Set while a batch's PR is open: the folder is `pending` until it merges (D26). */
  pr: PullRequestRef | null
  /** Changes on this computer that are not on GitHub yet: uncommitted + committed-but-unpushed. */
  pending: FileChange[]
  /** Never staged: ≥ 95 MiB (D11). */
  tooBig: TooBigFile[]
  /** Top-level `.gitignore` patterns and how many files git currently ignores (D10). */
  ignored: { patterns: string[]; count: number }
  /** The Docs/Draw app has its own sync switched on for this folder — AutoSync stands back (D27, `other-app`). */
  alsoSyncedBy: OtherApp | null
  offline: boolean
  /** Last pass that ended level with origin — in PR mode, with the batch merged into the branch. */
  lastSyncedAt: number | null
  /** Last successful `git fetch`. */
  lastCheckedAt: number | null
  /** When the current run of unsent changes began (pending > 1 h notifies once, D7). */
  pendingSince: number | null
  /** When the debounce fires — 30 s (D3), or 5 min in PR mode (D24); drives "Sends in 0:23" / "Opens a PR in 4:12". */
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
  /** D19: `system` follows macOS/Windows; `light`/`dark` force the window's look. */
  theme: ThemeChoice
}

export type ThemeChoice = 'system' | 'light' | 'dark'

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
  | { ok: false; path: string; reason: 'not-root'; /** The top of the repo the picked folder sits inside. */ root: string }
  | { ok: false; path: string; reason: Exclude<FolderRejection, 'not-root'> }

/** Where a menu bar / notification click wants the window to go. */
export interface NavTarget {
  folderId: string | null
  /** Sheets a click can open. The folder ones act on `folderId` and come from the right-click menu (D18). */
  sheet?: 'settings' | 'pause' | 'resume' | 'folder-off' | 'folder-on' | 'remove' | 'rename'
  /** Right-click "Copy AI prompt": the prompt texts live in the renderer, so main asks it to copy. */
  copyPrompt?: boolean
}
