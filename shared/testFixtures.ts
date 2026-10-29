// Test-only builders for the contract shapes, shared by the client and desktop suites.
import { DEFAULT_SETTINGS } from './status'
import type { ActivityEntry, AppStatus, FolderStatus } from './types'

/** A synced, enabled GitHub folder; tests override what they are about. */
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
    repo: 'github.com/yasin/notes',
    settings: DEFAULT_SETTINGS,
    publishVia: 'push',
    pr: null,
    pending: [],
    outside: [],
    tooBig: [],
    inUse: [],
    ignored: { patterns: [], count: 0 },
    alsoSyncedBy: null,
    offline: false,
    lastSyncedAt: null,
    lastCheckedAt: null,
    pendingSince: null,
    sendAt: null,
    retryAt: null,
    pullAt: null,
    ...extra,
  }
}

export function makeStatus(folders: FolderStatus[], extra: Partial<AppStatus> = {}): AppStatus {
  return { folders, paused: false, gitMissing: false, hostname: 'MacBook-Pro', launchAtLogin: false, theme: 'system', settingsFolder: null, settingsFolderMissing: false, ...extra }
}

export function makeEntry(extra: Partial<ActivityEntry> & Pick<ActivityEntry, 'sha' | 'time'>): ActivityEntry {
  return { kind: 'sent', host: 'MacBook-Pro', subject: 'sync', files: [{ status: 'M', path: 'a.md' }], ...extra }
}
