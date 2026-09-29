import { describe, expect, it } from 'vitest'
import type { Attention } from '@shared/types'
import { makeFolder, makeStatus } from '@shared/testFixtures'
import { folderView, overall } from './summary'

const ok = { paused: false, gitMissing: false }
const change = { status: 'M' as const, path: 'a.md' }

describe('folderView headline', () => {
  it.each([
    ['synced', makeFolder(), "Everything's synced", 'Synced'],
    ['pending', makeFolder({ state: 'pending', pending: [change, change] }), '2 changes waiting to send', '2 waiting'],
    ['pending one', makeFolder({ state: 'pending', pending: [change] }), '1 change waiting to send', '1 waiting'],
    ['sending', makeFolder({ state: 'syncing', direction: 'up' }), 'Sending your changes to GitHub…', 'Sending changes…'],
    ['receiving', makeFolder({ state: 'syncing', direction: 'down' }), 'Getting changes from GitHub…', 'Getting changes…'],
    ['offline', makeFolder({ state: 'pending', offline: true, pending: [change] }), "You're offline", 'Offline · 1 waiting'],
    [
      'conflict',
      makeFolder({ state: 'attention', attention: { kind: 'conflict', conflicts: [] } }),
      'Still syncing — but something needs you',
      'Conflict · both kept',
    ],
    ['auth', makeFolder({ state: 'attention', attention: { kind: 'auth' } }), 'Not syncing until this is fixed', 'GitHub sign-in failed'],
    ['off', makeFolder({ enabled: false, state: 'off' }), 'Sync is off for this folder', 'Sync off'],
    [
      'waiting on a PR',
      makeFolder({ state: 'pending', publishVia: 'pr', pr: { number: 12, url: 'https://github.com/yasin/notes/pull/12' }, pending: [change] }),
      'Your changes are in a pull request',
      'Waiting on PR #12',
    ],
    ['PR not opened yet', makeFolder({ state: 'pending', publishVia: 'pr', pending: [change] }), '1 change waiting to send', '1 waiting'],
  ])('%s', (_, folder, head, short) => {
    expect(folderView(folder, ok)).toMatchObject({ head, short })
  })

  it('pause and missing git override the folder state', () => {
    const f = makeFolder({ state: 'attention', attention: { kind: 'auth' } })
    expect(folderView(f, { paused: true, gitMissing: false })).toMatchObject({ kind: 'paused', cls: 'off', head: 'Syncing is paused' })
    expect(folderView(f, { paused: false, gitMissing: true })).toMatchObject({ kind: 'git-missing', cls: 'attention' })
    // a disabled folder stays "Sync off" even while paused
    expect(folderView(makeFolder({ enabled: false }), { paused: true, gitMissing: false }).short).toBe('Sync off')
  })

  it.each<[Attention, string]>([
    [{ kind: 'busy-repo', detail: 'rebase' }, 'Rebase in progress'],
    [{ kind: 'busy-repo', detail: 'merge' }, 'Merge in progress'],
    [{ kind: 'busy-repo', detail: 'detached' }, 'Not on a branch'],
    [{ kind: 'busy-repo', detail: 'side-branch' }, 'On a side branch'],
    [{ kind: 'no-gh' }, 'GitHub CLI not set up'],
    [{ kind: 'pr-closed', detail: 'https://github.com/yasin/notes/pull/7' }, 'PR closed · not merged'],
    [{ kind: 'other-app', detail: 'Docs' }, 'Two apps sync this'],
    [{ kind: 'no-identity' }, 'Git name & email missing'],
    [{ kind: 'error', detail: 'fatal: bad object' }, 'Sync error'],
  ])('short text for %o', (attention, short) => {
    expect(folderView(makeFolder({ state: 'attention', attention }), ok).short).toBe(short)
  })
})

describe('overall', () => {
  const synced = makeFolder({ id: 's' })
  const pending = makeFolder({ id: 'p', state: 'pending', pending: [change] })
  const syncing = makeFolder({ id: 'y', state: 'syncing', direction: 'up' })
  const conflict = makeFolder({ id: 'c', state: 'attention', attention: { kind: 'conflict', conflicts: [] } })
  const off = makeFolder({ id: 'o', enabled: false, state: 'off' })

  it('counts by colour and picks the worst', () => {
    const o = overall(makeStatus([synced, pending, syncing, conflict, off]))
    expect(o).toEqual({ worst: 'attention', synced: 1, pending: 1, syncing: 1, attention: 1, off: 1, total: 5 })
    expect(overall(makeStatus([synced, syncing])).worst).toBe('syncing')
    expect(overall(makeStatus([synced, off])).worst).toBe('synced')
    expect(overall(makeStatus([off])).worst).toBe('off')
    expect(overall(makeStatus([conflict], { paused: true })).worst).toBe('off')
  })
})
