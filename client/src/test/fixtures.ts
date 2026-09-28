import type { ActivityEntry, AppStatus, FolderStatus } from '@shared/types'

export function makeFolder(extra: Partial<FolderStatus> = {}): FolderStatus {
  return {
    id: 'notes',
    path: '/Users/yasin/Documents/GitHub/notes',
    name: 'notes',
    alias: null,
    enabled: true,
    state: 'synced',
    direction: null,
    attention: null,
    branch: 'main',
    remoteUrl: 'https://github.com/yasin/notes.git',
    webUrl: 'https://github.com/yasin/notes',
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
    ...extra,
  }
}

export function makeStatus(folders: FolderStatus[], extra: Partial<AppStatus> = {}): AppStatus {
  return { folders, paused: false, gitMissing: false, hostname: 'MacBook-Pro', launchAtLogin: false, ...extra }
}

export function makeEntry(extra: Partial<ActivityEntry> & Pick<ActivityEntry, 'sha' | 'time'>): ActivityEntry {
  return { kind: 'sent', host: 'MacBook-Pro', subject: 'sync', files: [{ status: 'M', path: 'a.md' }], ...extra }
}
