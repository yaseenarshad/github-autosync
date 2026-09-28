import type { ActivityEntry, ActivityKind, ActivityPage } from '@shared/types'
import { findGit, git } from './exec'
import { isConflictCopy, parseNameStatus } from './detect'

/**
 * D10: the Activity log is read from git history only — nothing is recorded anywhere else, so every
 * computer shows the same story and a restart loses nothing.
 */

export const ACTIVITY_PAGE_SIZE = 200

/** `sync (<host>): …` or a bare `sync (<host>)` — the subjects `commitMessage` writes. */
const SYNC_SUBJECT = /^sync \(([^)]+)\)(?::|$)/

/**
 * Each commit is `\x1e<sha>\x1f<time>\x1f<author>\x1f<subject>\0`, then (with `-z`) a newline and
 * the name-status tokens, NUL-separated. The record separator can't appear in a subject git wrote
 * from a `-m`, and paths can't contain NUL, so splitting is exact.
 */
const FORMAT = '%x1e%H%x1f%ct%x1f%an%x1f%s'

export function classify(subject: string, author: string, files: ActivityEntry['files'], thisHost: string): { kind: ActivityKind; host: string } {
  const sync = SYNC_SUBJECT.exec(subject)
  const host = sync?.[1] ?? author
  // A replayed commit that ADDED a keep-both copy (D6) is the conflict, whoever's subject it carries.
  if (files.some((f) => f.status === 'A' && isConflictCopy(f.path))) return { kind: 'conflict', host }
  if (sync === null) return { kind: 'manual', host }
  return { kind: host === thisHost ? 'sent' : 'received', host }
}

export function parseLog(stdout: string, thisHost: string): ActivityEntry[] {
  return stdout
    .split('\x1e')
    .filter((chunk) => chunk !== '')
    .map((chunk) => {
      const nul = chunk.indexOf('\0')
      const [sha = '', ct = '0', author = '', subject = ''] = chunk.slice(0, nul === -1 ? undefined : nul).split('\x1f')
      const tokens = nul === -1 ? [] : chunk.slice(nul + 1).replace(/^\n/, '').split('\0').filter((t) => t !== '')
      const files = parseNameStatus(tokens)
      return { sha, time: Number(ct) * 1000, subject, files, ...classify(subject, author, files, thisHost) }
    })
}

/** Newest first, `ACTIVITY_PAGE_SIZE` per page; `cursor` is how many commits to skip. A repo with no commits (or no git) is an empty page. */
export async function readActivity(root: string, thisHost: string, cursor = 0, candidates?: readonly string[]): Promise<ActivityPage> {
  const bin = await findGit(candidates)
  if (bin === null) return { entries: [], cursor: null }
  // One more than a page, so "is there an older page?" needs no second call. `-M`: renames show as
  // renames even where a user's config switched detection off.
  const res = await git(bin, root, ['log', '-z', '-M', '--name-status', `--format=${FORMAT}`, `--skip=${cursor}`, '-n', String(ACTIVITY_PAGE_SIZE + 1)])
  if (res.code !== 0) return { entries: [], cursor: null }
  const entries = parseLog(res.stdout, thisHost)
  if (entries.length <= ACTIVITY_PAGE_SIZE) return { entries, cursor: null }
  return { entries: entries.slice(0, ACTIVITY_PAGE_SIZE), cursor: cursor + ACTIVITY_PAGE_SIZE }
}
