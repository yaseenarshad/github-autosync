import type { AppStatus, FolderStatus } from '@shared/types'

/** A synced, enabled folder; tests override what they are about. */
export function folder(over: Partial<FolderStatus> = {}): FolderStatus {
  return {
    id: 'a',
    path: '/Users/me/notes',
    name: 'notes',
    alias: null,
    enabled: true,
    state: 'synced',
    direction: null,
    attention: null,
    branch: 'main',
    remoteUrl: 'git@github.com:me/notes.git',
    webUrl: 'https://github.com/me/notes',
    pending: [],
    tooBig: [],
    ignored: { patterns: [], count: 0 },
    alsoSyncedBy: null,
    offline: false,
    lastSyncedAt: null,
    lastCheckedAt: null,
    pendingSince: null,
    sendAt: null,
    retryAt: null,
    ...over,
  }
}

export function appStatus(folders: FolderStatus[], over: Partial<AppStatus> = {}): AppStatus {
  return { folders, paused: false, gitMissing: false, hostname: 'Mac-A', launchAtLogin: true, theme: 'system', ...over }
}
