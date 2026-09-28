import type { ActivityEntry, ActivityPage, FileChange } from '@shared/types'
import { dayName, MINUTE, startOfDay } from './time'

export type ActivityFilter = 'all' | 'sent' | 'received' | 'conflict'

/** Consecutive syncs from one computer less than this apart collapse into one row. */
export const RUN_GAP = 20 * MINUTE

/** Entries are newest first. `manual` commits only show under All. */
export function filterEntries(entries: ActivityEntry[], filter: ActivityFilter, query: string): ActivityEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((e) => (filter === 'all' || e.kind === filter) && (!q || e.files.some((f) => f.path.toLowerCase().includes(q))))
}

export interface Day {
  key: number
  name: string
  entries: ActivityEntry[]
  files: number
  sent: number
  received: number
  conflicts: number
}

export function groupDays(entries: ActivityEntry[], now: number): Day[] {
  const days: Day[] = []
  for (const e of entries) {
    const key = startOfDay(e.time)
    if (days.at(-1)?.key !== key) days.push({ key, name: dayName(e.time, now), entries: [], files: 0, sent: 0, received: 0, conflicts: 0 })
    days.at(-1)!.entries.push(e)
  }
  for (const d of days) {
    d.files = uniqueFiles(d.entries).length
    d.sent = d.entries.filter((e) => e.kind === 'sent').length
    d.received = d.entries.filter((e) => e.kind === 'received').length
    d.conflicts = d.entries.filter((e) => e.kind === 'conflict').length
  }
  return days
}

/** Bursts: consecutive sent (or received) entries from the same computer, each less than RUN_GAP after the next older one. */
export function groupRuns(entries: ActivityEntry[]): ActivityEntry[][] {
  const runs: ActivityEntry[][] = []
  for (const e of entries) {
    const run = runs.at(-1)
    const last = run?.at(-1)
    const joins =
      last && (e.kind === 'sent' || e.kind === 'received') && e.kind === last.kind && e.host === last.host && last.time - e.time < RUN_GAP
    if (joins) run!.push(e)
    else runs.push([e])
  }
  return runs
}

/** Each path once, newest change wins. */
export function uniqueFiles(entries: ActivityEntry[]): FileChange[] {
  const seen = new Map<string, FileChange>()
  for (const e of entries) for (const f of e.files) if (!seen.has(f.path)) seen.set(f.path, f)
  return [...seen.values()]
}

/** "a.md, b.md, c.md +2 more" */
export function fileList(files: FileChange[]): string {
  const names = files
    .slice(0, 3)
    .map((f) => f.path)
    .join(', ')
  return files.length > 3 ? `${names} +${files.length - 3} more` : names
}

/** Older page appended; the cursor may overlap what's loaded when new commits arrived in between. */
export function appendPage(loaded: ActivityPage, older: ActivityPage): ActivityPage {
  const known = new Set(loaded.entries.map((e) => e.sha))
  return { entries: [...loaded.entries, ...older.entries.filter((e) => !known.has(e.sha))], cursor: older.cursor }
}

/**
 * A fresh first page replaces the newest part of what's loaded but keeps older pages the user already fetched.
 * Entries newer than the page's oldest one are dropped, since a pull can rewrite unsent commits.
 */
export function mergeFirstPage(loaded: ActivityPage, first: ActivityPage): ActivityPage {
  const oldest = first.entries.at(-1)
  if (!oldest || first.cursor === null) return first
  const known = new Set(first.entries.map((e) => e.sha))
  const older = loaded.entries.filter((e) => e.time <= oldest.time && !known.has(e.sha))
  return older.length ? { entries: [...first.entries, ...older], cursor: loaded.cursor } : first
}
