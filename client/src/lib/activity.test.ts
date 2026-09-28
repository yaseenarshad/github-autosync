import { describe, expect, it } from 'vitest'
import { makeEntry } from '@shared/testFixtures'
import { appendPage, fileList, filterEntries, groupDays, groupRuns, mergeFirstPage, RUN_GAP } from './activity'
import { MINUTE } from './time'

const now = new Date(2026, 8, 27, 18, 0).getTime()
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).getTime()

describe('groupDays', () => {
  it('splits newest-first entries by calendar day and totals each', () => {
    const days = groupDays(
      [
        makeEntry({ sha: 'a', time: at(27, 17), files: [{ status: 'M', path: 'x.md' }] }),
        makeEntry({
          sha: 'b',
          time: at(27, 9),
          kind: 'received',
          host: 'Mac-Studio',
          files: [
            { status: 'M', path: 'x.md' },
            { status: 'A', path: 'y.md' },
          ],
        }),
        makeEntry({ sha: 'c', time: at(26, 23, 59), kind: 'conflict', host: 'Mac-Studio' }),
        makeEntry({ sha: 'd', time: at(25, 9) }),
      ],
      now,
    )
    expect(days.map((d) => d.name)).toEqual(['Today', 'Yesterday', 'Friday, Sep 25'])
    expect(days[0]).toMatchObject({ files: 2, sent: 1, received: 1, conflicts: 0 })
    expect(days[0].entries.map((e) => e.sha)).toEqual(['a', 'b'])
    expect(days[1]).toMatchObject({ files: 1, sent: 0, received: 0, conflicts: 1 })
  })
})

describe('groupRuns', () => {
  const shas = (runs: { sha: string }[][]) => runs.map((r) => r.map((e) => e.sha).join(''))

  it('collapses consecutive same-kind, same-host syncs less than 20 min apart', () => {
    const t = at(27, 17)
    const runs = groupRuns([
      makeEntry({ sha: 'a', time: t }),
      makeEntry({ sha: 'b', time: t - 5 * MINUTE }),
      // measured from the previous entry, not the first: a long run keeps going
      makeEntry({ sha: 'c', time: t - 24 * MINUTE }),
    ])
    expect(shas(runs)).toEqual(['abc'])
  })

  it('breaks at a 20 minute gap', () => {
    const t = at(27, 17)
    expect(shas(groupRuns([makeEntry({ sha: 'a', time: t }), makeEntry({ sha: 'b', time: t - RUN_GAP })]))).toEqual(['a', 'b'])
    expect(shas(groupRuns([makeEntry({ sha: 'a', time: t }), makeEntry({ sha: 'b', time: t - RUN_GAP + 1 })]))).toEqual(['ab'])
  })

  it('breaks when the host or kind changes', () => {
    const t = at(27, 17)
    const runs = groupRuns([
      makeEntry({ sha: 'a', time: t, kind: 'received', host: 'Mac-Studio' }),
      makeEntry({ sha: 'b', time: t - MINUTE, kind: 'received', host: 'MacBook-Air' }),
      makeEntry({ sha: 'c', time: t - 2 * MINUTE, kind: 'sent' }),
      makeEntry({ sha: 'd', time: t - 3 * MINUTE, kind: 'sent' }),
    ])
    expect(shas(runs)).toEqual(['a', 'b', 'cd'])
  })

  it('never groups conflicts or manual commits', () => {
    const t = at(27, 17)
    const runs = groupRuns([
      makeEntry({ sha: 'a', time: t, kind: 'conflict', host: 'Mac-Studio' }),
      makeEntry({ sha: 'b', time: t - MINUTE, kind: 'conflict', host: 'Mac-Studio' }),
      makeEntry({ sha: 'c', time: t - 2 * MINUTE, kind: 'manual', host: 'Yasin' }),
      makeEntry({ sha: 'd', time: t - 3 * MINUTE, kind: 'manual', host: 'Yasin' }),
    ])
    expect(shas(runs)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('filterEntries', () => {
  const entries = [
    makeEntry({ sha: 'a', time: 3, files: [{ status: 'M', path: 'Stripe/SKILL.md' }] }),
    makeEntry({ sha: 'b', time: 2, kind: 'received', files: [{ status: 'A', path: 'linear/api.md' }] }),
    makeEntry({ sha: 'c', time: 1, kind: 'manual', files: [{ status: 'M', path: 'stripe/notes.md' }] }),
  ]
  const shas = (list: { sha: string }[]) => list.map((e) => e.sha)

  it('filters by kind; manual commits only under All', () => {
    expect(shas(filterEntries(entries, 'all', ''))).toEqual(['a', 'b', 'c'])
    expect(shas(filterEntries(entries, 'sent', ''))).toEqual(['a'])
    expect(shas(filterEntries(entries, 'received', ''))).toEqual(['b'])
  })

  it('searches file paths case-insensitively', () => {
    expect(shas(filterEntries(entries, 'all', ' stripe '))).toEqual(['a', 'c'])
    expect(shas(filterEntries(entries, 'sent', 'stripe'))).toEqual(['a'])
    expect(filterEntries(entries, 'all', 'nope')).toEqual([])
  })
})

it('lists up to three files then a count', () => {
  const f = (path: string) => ({ status: 'M' as const, path })
  expect(fileList([f('a'), f('b')])).toBe('a, b')
  expect(fileList([f('a'), f('b'), f('c'), f('d'), f('e')])).toBe('a, b, c +2 more')
})

describe('paging', () => {
  const e = (sha: string, time: number) => makeEntry({ sha, time })

  it('appends an older page without duplicates', () => {
    const merged = appendPage({ entries: [e('a', 5), e('b', 4)], cursor: 2 }, { entries: [e('b', 4), e('c', 3)], cursor: 4 })
    expect(merged.entries.map((x) => x.sha)).toEqual(['a', 'b', 'c'])
    expect(merged.cursor).toBe(4)
  })

  it('folds a fresh first page in front of older loaded pages', () => {
    const loaded = { entries: [e('b', 4), e('c', 3), e('d', 2), e('e', 1)], cursor: null }
    const merged = mergeFirstPage(loaded, { entries: [e('a', 5), e('b', 4)], cursor: 2 })
    expect(merged.entries.map((x) => x.sha)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(merged.cursor).toBeNull()
  })

  it('drops rewritten commits newer than the fresh page', () => {
    const loaded = { entries: [e('old-a', 5), e('c', 3)], cursor: 9 }
    const merged = mergeFirstPage(loaded, { entries: [e('new-a', 6), e('c', 3)], cursor: 2 })
    expect(merged.entries.map((x) => x.sha)).toEqual(['new-a', 'c'])
    expect(merged.cursor).toBe(2)
  })

  it('takes the fresh page as-is when it holds all history', () => {
    const merged = mergeFirstPage({ entries: [e('x', 1)], cursor: null }, { entries: [e('a', 2)], cursor: null })
    expect(merged).toEqual({ entries: [e('a', 2)], cursor: null })
  })
})
