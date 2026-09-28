import type { AppStatus, Attention, FolderStatus, SyncState } from '@shared/types'
import { plural } from './format'

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

export function attentionShort(a: Attention): string {
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
      return a.detail === 'detached' ? 'Not on a branch' : a.detail === 'merge' ? 'Merge in progress' : 'Rebase in progress'
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
  if (f.state === 'pending') {
    return { kind: 'pending', cls: 'pending', short: `${n} waiting`, head: `${plural(n, 'change')} waiting to send`, icon: 'clock' }
  }
  return { kind: 'synced', cls: 'synced', short: 'Synced', head: "Everything's synced", icon: 'check' }
}

export const RANK: Record<SyncState, number> = { attention: 4, pending: 3, syncing: 2, synced: 1, off: 0 }

export interface Overall {
  worst: SyncState
  synced: number
  pending: number
  syncing: number
  attention: number
  off: number
  total: number
}

export function overall(status: AppStatus): Overall {
  const views = status.folders.map((f) => folderView(f, status))
  const n = (c: SyncState) => views.filter((v) => v.cls === c).length
  return {
    worst: views.reduce<SyncState>((w, v) => (RANK[v.cls] > RANK[w] ? v.cls : w), 'off'),
    synced: n('synced'),
    pending: n('pending'),
    syncing: n('syncing'),
    attention: n('attention'),
    off: n('off'),
    total: views.length,
  }
}

/** One line for the toolbar and the "All folders" row. */
export function summary(status: AppStatus, o: Overall = overall(status)): string {
  if (!o.total) return 'No folders yet'
  if (status.paused) return 'Paused'
  if (status.gitMissing) return 'Git not found'
  if (o.attention) return `${o.attention} ${o.attention === 1 ? 'folder needs' : 'folders need'} you`
  if (o.pending && status.folders.some((f) => f.enabled && f.offline)) return 'Offline · changes waiting'
  if (o.syncing) return 'Syncing…'
  if (o.pending) return `${o.pending} waiting to send`
  if (o.off === o.total) return 'Sync is off'
  return 'All synced'
}
