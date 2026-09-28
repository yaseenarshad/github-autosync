import { describe, expect, it } from 'vitest'
import type { Attention } from '@shared/types'
import { createNoticeRules, PENDING_NOTICE_MS } from './notify'
import { makeFolder, makeStatus } from '@shared/testFixtures'

const NOW = 1_800_000_000_000
const conflict = (...copies: string[]): Attention => ({ kind: 'conflict', conflicts: copies.map((copy) => ({ original: copy.replace(/ \(conflict.*\)/, ''), copy })) })

describe('notice rules (D7)', () => {
  it('fires once when a folder ENTERS attention, not while it persists, and again after it cleared', () => {
    const rules = createNoticeRules()
    const auth = makeFolder({ state: 'attention', attention: { kind: 'auth', detail: 'fatal: Authentication failed' } })
    expect(rules(makeStatus([makeFolder()]), NOW)).toEqual([])
    expect(rules(makeStatus([auth]), NOW)).toEqual([{ folderId: 'notes', title: 'notes', body: expect.stringMatching(/sign-in/) }])
    expect(rules(makeStatus([auth]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder({ state: 'syncing', attention: auth.attention })]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder()]), NOW)).toEqual([])
    expect(rules(makeStatus([auth]), NOW)).toHaveLength(1)
  })

  it('a different kind is news', () => {
    const rules = createNoticeRules()
    rules(makeStatus([makeFolder({ state: 'attention', attention: { kind: 'auth' } })]), NOW)
    expect(rules(makeStatus([makeFolder({ state: 'attention', attention: { kind: 'error', detail: 'fatal: boom' } })]), NOW)).toEqual([
      { folderId: 'notes', title: 'notes', body: 'Syncing has stopped: fatal: boom' },
    ])
  })

  it('conflicts fire again only when the set of copies grows', () => {
    const rules = createNoticeRules()
    const one = 'a (conflict Mac-B, 2026-09-27).md'
    const two = 'b (conflict Mac-B, 2026-09-27).md'
    expect(rules(makeStatus([makeFolder({ state: 'attention', attention: conflict(one) })]), NOW)).toEqual([{ folderId: 'notes', title: 'notes', body: 'a.md changed on two computers — both versions kept.' }])
    expect(rules(makeStatus([makeFolder({ state: 'attention', attention: conflict(one) })]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder({ state: 'attention', attention: conflict(one, two) })]), NOW)).toEqual([{ folderId: 'notes', title: 'notes', body: '2 files changed on two computers — both versions kept.' }])
    expect(rules(makeStatus([makeFolder({ state: 'attention', attention: conflict(two) })]), NOW)).toEqual([])
  })

  it('pending over an hour fires once per episode', () => {
    const rules = createNoticeRules()
    const since = NOW - PENDING_NOTICE_MS
    expect(rules(makeStatus([makeFolder({ state: 'pending', pendingSince: since + 1 })]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder({ state: 'pending', pendingSince: since })]), NOW)).toEqual([{ folderId: 'notes', title: 'notes', body: expect.stringMatching(/over an hour/) }])
    expect(rules(makeStatus([makeFolder({ state: 'pending', pendingSince: since })]), NOW + 60_000)).toEqual([])
    // A new episode (sent, then new changes that also got stuck) is news again.
    expect(rules(makeStatus([makeFolder({ state: 'pending', pendingSince: since - 5 })]), NOW)).toHaveLength(1)
  })

  it('never says anything about success, or about a folder the user switched off', () => {
    const rules = createNoticeRules()
    expect(rules(makeStatus([makeFolder({ state: 'synced', lastSyncedAt: NOW })]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder({ state: 'off', enabled: false, attention: { kind: 'auth' }, pendingSince: 0 })]), NOW)).toEqual([])
    expect(rules(makeStatus([makeFolder({ state: 'off', attention: { kind: 'auth' } })], { paused: true }), NOW)).toEqual([])
  })
})
