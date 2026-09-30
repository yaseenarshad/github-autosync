import type { AppStatus, Attention, FolderStatus, SyncState } from '@shared/types'
import { byWorst, plural } from '@shared/status'

/** Which status-card variant a folder shows; `cls` is the dot/tag colour for it. */
export type ViewKind = 'off' | 'paused' | 'git-missing' | 'attention' | 'syncing' | 'offline' | 'pending' | 'synced'

export interface FolderView {
  kind: ViewKind
  cls: SyncState
  /** Sidebar sub-line and overview tag. */
  short: string
  /** Status card headline. */
  head: string
  icon: 'check' | 'clock' | 'sync' | 'alert' | 'pause' | 'wifi-off'
}

type Globals = Pick<AppStatus, 'paused' | 'gitMissing'>

function attentionShort(a: Attention): string {
  switch (a.kind) {
    case 'conflict':
      return 'Conflict · both kept'
    case 'auth':
      return 'GitHub sign-in failed'
    case 'no-git':
      return 'Git not found'
    case 'no-identity':
      return 'Git name & email missing'
    case 'busy-repo':
      if (a.detail === 'side-branch') return 'On a side branch'
      return a.detail === 'detached' ? 'Not on a branch' : a.detail === 'merge' ? 'Merge in progress' : 'Rebase in progress'
    case 'no-gh':
      return 'GitHub CLI not set up'
    case 'pr-closed':
      return 'PR closed · not merged'
    case 'other-app':
      return 'Two apps sync this'
    case 'error':
      return 'Sync error'
  }
}

export function folderView(f: FolderStatus, app: Globals): FolderView {
  if (!f.enabled) return { kind: 'off', cls: 'off', short: 'Sync off', head: 'Sync is off for this folder', icon: 'pause' }
  if (app.paused) return { kind: 'paused', cls: 'off', short: 'Paused', head: 'Syncing is paused', icon: 'pause' }
  if (app.gitMissing) return { kind: 'git-missing', cls: 'attention', short: 'Git not found', head: "Git isn't installed", icon: 'alert' }
  if (f.state === 'attention' && f.attention) {
    // Keep-both conflicts don't stop syncing (D6); every other problem does.
    const head = f.attention.kind === 'conflict' ? 'Still syncing — but something needs you' : 'Not syncing until this is fixed'
    return { kind: 'attention', cls: 'attention', short: attentionShort(f.attention), head, icon: 'alert' }
  }
  if (f.state === 'syncing') {
    return f.direction === 'down'
      ? { kind: 'syncing', cls: 'syncing', short: 'Getting changes…', head: 'Getting changes from GitHub…', icon: 'sync' }
      : { kind: 'syncing', cls: 'syncing', short: 'Sending changes…', head: 'Sending your changes to GitHub…', icon: 'sync' }
  }
  const n = f.pending.length
  if (f.offline) {
    return { kind: 'offline', cls: f.state, short: n ? `Offline · ${n} waiting` : 'Offline', head: "You're offline", icon: 'wifi-off' }
  }
  if (f.state === 'pending' && f.pr) {
    return { kind: 'pending', cls: 'pending', short: `Waiting on PR #${f.pr.number}`, head: 'Your changes are in a pull request', icon: 'clock' }
  }
  if (f.state === 'pending') {
    return { kind: 'pending', cls: 'pending', short: `${n} waiting`, head: `${plural(n, 'change')} waiting to send`, icon: 'clock' }
  }
  return { kind: 'synced', cls: 'synced', short: 'Synced', head: "Everything's synced", icon: 'check' }
}

export interface Overall {
  worst: SyncState
  synced: number
  pending: number
  syncing: number
  attention: number
  off: number
  total: number
}

/** Counts by the colour each folder shows (so pause and missing git count as they look), and the worst of them. */
export function overall(status: AppStatus): Overall {
  const colours = status.folders.map((f) => folderView(f, status).cls)
  const n = (c: SyncState) => colours.filter((v) => v === c).length
  const [worst = 'off'] = [...colours].sort(byWorst)
  return { worst, synced: n('synced'), pending: n('pending'), syncing: n('syncing'), attention: n('attention'), off: n('off'), total: colours.length }
}
