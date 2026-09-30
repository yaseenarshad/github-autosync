import { describe, expect, it } from 'vitest'
import type { SyncState } from './types'
import { byWorst, CHECKS_EVERY, clock, headline, isGitHubUrl, lastSyncedAt, plural, SENDS_AFTER } from './status'
import { makeFolder, makeStatus } from './testFixtures'

const change = { status: 'M' as const, path: 'a.md' }

describe('isGitHubUrl', () => {
  it('is https://github.com/ pages and nothing else', () => {
    expect(isGitHubUrl('https://github.com/yasin/notes/pull/12')).toBe(true)
    expect(isGitHubUrl('https://github.com.evil.com/x')).toBe(false)
    expect(isGitHubUrl('https://github.company.com/yasin/notes/pull/12')).toBe(false)
    expect(isGitHubUrl('http://github.com/yasin/notes')).toBe(false)
    expect(isGitHubUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('byWorst', () => {
  it('orders attention, pending, syncing, synced, off', () => {
    const states: SyncState[] = ['off', 'synced', 'attention', 'syncing', 'pending']
    expect(states.sort(byWorst)).toEqual(['attention', 'pending', 'syncing', 'synced', 'off'])
  })
})

describe('headline (the window and the menu bar say the same)', () => {
  const synced = makeFolder({ id: 's' })
  const pending = makeFolder({ id: 'p', state: 'pending', pending: [change] })
  const syncing = makeFolder({ id: 'y', state: 'syncing', direction: 'up' })
  const conflict = makeFolder({ id: 'c', state: 'attention', attention: { kind: 'conflict', conflicts: [] } })
  const auth = makeFolder({ id: 'a', state: 'attention', attention: { kind: 'auth' } })
  const off = makeFolder({ id: 'o', enabled: false, state: 'off' })

  it.each([
    ['no folders', makeStatus([]), 'No folders yet'],
    ['paused', makeStatus([{ ...conflict, state: 'off' }], { paused: true }), 'Paused'],
    ['git missing', makeStatus([synced], { gitMissing: true }), 'Git not found'],
    ['one needs you', makeStatus([conflict, pending]), '1 folder needs you'],
    ['several need you', makeStatus([conflict, auth]), '2 folders need you'],
    ['offline', makeStatus([{ ...pending, offline: true }, syncing]), 'Offline · changes waiting'],
    ['syncing', makeStatus([pending, syncing]), 'Syncing…'],
    ['waiting', makeStatus([pending, synced]), '1 waiting to send'],
    ['all synced', makeStatus([synced, off]), 'All synced'],
    ['all off', makeStatus([off]), 'Sync is off'],
  ])('%s', (_, status, text) => {
    expect(headline(status)).toBe(text)
  })
})

describe('wording', () => {
  it('plurals, regular and irregular', () => {
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(3, 'file')).toBe('3 files')
    expect(plural(2, 'folder needs', 'folders need')).toBe('2 folders need')
  })

  it('reads a clock time as h:mm AM/PM', () => {
    expect(clock(new Date(2026, 8, 27, 15, 5).getTime())).toBe('3:05 PM')
  })

  it('words the cadence from the timers', () => {
    expect(SENDS_AFTER).toBe('30s after you stop editing')
    expect(CHECKS_EVERY).toBe('every minute')
  })
})

describe('lastSyncedAt', () => {
  it('is the latest of any folder, or null before the first sync', () => {
    expect(lastSyncedAt([])).toBeNull()
    expect(lastSyncedAt([makeFolder()])).toBeNull()
    expect(lastSyncedAt([makeFolder({ lastSyncedAt: 5 }), makeFolder({ lastSyncedAt: 9, enabled: false }), makeFolder()])).toBe(9)
  })
})
