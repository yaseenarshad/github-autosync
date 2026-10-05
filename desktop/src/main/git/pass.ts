// Moved out of sync.ts (itself copied from yaseen-draw-app@89b29c9) so pullRequest.ts shares it without an import cycle; new: `fromGhFailure`, `commitPending`, `rebaseKeepingBoth`, `countAhead`.
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { TooBigFile } from '@shared/types'
import { repoState } from './detect'
import { classifyGitFailure, firstMeaningfulLine, git, zList, type GitResult } from './exec'
import type { GhFailure } from './github'
import { resolveRebase } from './resolve'
import type { PassResult } from './sync'

/**
 * What both routes of a pass share — straight to the branch (`sync.ts`) or one PR per batch
 * (`pullRequest.ts`, D23): the transfer budget, the commit step and its subject (which is also the
 * PR title), how a failure becomes a verdict, and a rebase that keeps both sides of a conflict (D6)
 * and commits what is saved under it (D30).
 */

/** A stalled transfer, not a slow one: a big folder over a home uplink can take minutes and must not restart from zero every 30 s. */
export const TRANSFER_TIMEOUT_MS = 10 * 60_000

/** GitHub refuses a push with any blob over 100 MiB; 95 leaves headroom for a file that is still growing (D11). */
export const TOO_BIG_BYTES = 95 * 1024 * 1024

/** How many file names a commit subject lists before it summarises the rest. */
const SUBJECT_FILES = 3

/** `sync (Mac-A): a.md, b.md, c.md +2 more`, or a bare `sync (Mac-A)`. Basenames — a subject is a glance; the paths are in the diff. */
export function commitMessage(host: string, files: readonly string[]): string {
  const names = files.map((f) => path.posix.basename(f)).filter((n) => n !== '')
  if (names.length === 0) return `sync (${host})`
  const rest = names.length - SUBJECT_FILES
  const head = names.slice(0, SUBJECT_FILES).join(', ')
  return rest > 0 ? `sync (${host}): ${head} +${rest} more` : `sync (${host}): ${head}`
}

/** The files in `rel` at or over the line. A path that will not stat (deleted) is not. */
async function oversize(root: string, rel: readonly string[]): Promise<TooBigFile[]> {
  const out: TooBigFile[] = []
  for (const p of rel) {
    const st = await stat(path.join(root, p)).catch(() => null)
    if (st !== null && st.isFile() && st.size >= TOO_BIG_BYTES) out.push({ path: p, bytes: st.size })
  }
  return out
}

/** How many times `git add` is asked before its failure is believed. */
const STAGE_TRIES = 3

/**
 * D11 — a file over the line must never reach a commit: GitHub refuses the WHOLE push for one
 * oversize blob, so it would silently jam every other change behind it, forever. Held back (listed
 * in the status), everything else goes. Idempotent — a held-back file is still dirty, so every pass
 * sees it again:
 *  - BEFORE `add -A` the untracked and modified files are stat'ed and the oversize ones excluded by
 *    literal pathspec — excluded, not added-then-reset, so no 100 MB blob is ever hashed into
 *    `.git/objects`;
 *  - AFTER, anything staged over the line is unstaged — the belt for a file that grew in between.
 * OUT OF SCOPE: a file already COMMITTED over the limit; the push keeps failing (`error`).
 */
async function stageWithinLimit(bin: string, root: string): Promise<{ failed: GitResult | null; tooBig: TooBigFile[] }> {
  const untracked = zList(await git(bin, root, ['ls-files', '-z', '--others', '--exclude-standard']))
  const modified = zList(await git(bin, root, ['ls-files', '-z', '--modified']))
  const held = await oversize(root, [...new Set([...untracked, ...modified])])
  const add = ['add', '-A', '--', '.', ...held.map((f) => `:(exclude,literal)${f.path}`)]
  let staged = await git(bin, root, add)
  // A file being written while git reads it fails the whole add ("short read") and stages nothing. So a
  // refusal is asked again, whatever it said; a timeout (a negative code) is not.
  for (let left = STAGE_TRIES - 1; staged.code > 0 && left > 0; left -= 1) staged = await git(bin, root, add)
  if (staged.code !== 0) return { failed: staged, tooBig: held }
  const late = await oversize(root, zList(await git(bin, root, ['diff', '--cached', '--name-only', '-z'])))
  if (late.length > 0) await git(bin, root, ['reset', '-q', '--', ...late.map((f) => `:(literal)${f.path}`)])
  const all = new Map([...held, ...late].map((f) => [f.path, f]))
  return { failed: null, tooBig: [...all.values()].sort((a, b) => a.path.localeCompare(b.path)) }
}

/** Local edits become one commit, minus anything GitHub would refuse (D11). `committed`: there was something to commit, and it is. */
export async function commitPending(bin: string, root: string, host: string): Promise<{ failed: GitResult | null; tooBig: TooBigFile[]; committed: boolean }> {
  const { failed, tooBig } = await stageWithinLimit(bin, root)
  if (failed !== null) return { failed, tooBig, committed: false }
  const staged = zList(await git(bin, root, ['diff', '--cached', '--name-only', '-z']))
  if (staged.length === 0) return { failed: null, tooBig, committed: false }
  const committed = await git(bin, root, ['commit', '-m', commitMessage(host, staged)])
  return { failed: committed.code === 0 ? null : committed, tooBig, committed: committed.code === 0 }
}

export type Verdict = Pick<PassResult, 'attention' | 'offline' | 'fetched' | 'level' | 'tooBig' | 'policy' | 'pr'>

export const CLEAN: Verdict = { attention: null, offline: false, fetched: false, level: false, tooBig: [], policy: null, pr: null }

/** offline → quiet retry; auth / identity → the user's to fix; anything else → git's own words. */
export function fromFailure(res: GitResult, tooBig: TooBigFile[], fetched = false): Verdict {
  const kind = classifyGitFailure(res)
  if (kind === 'offline') return { ...CLEAN, offline: true, fetched, tooBig }
  if (kind === 'identity') return { ...CLEAN, attention: { kind: 'no-identity' }, fetched, tooBig }
  return { ...CLEAN, attention: { kind: kind === 'auth' ? 'auth' : 'error', detail: firstMeaningfulLine(res) }, fetched, tooBig }
}

/** The same split for gh: offline retries quietly, everything else is the user's (`no-gh`, `auth`, `error`). */
export function fromGhFailure(failure: GhFailure, tooBig: TooBigFile[], fetched: boolean): Verdict {
  if (failure.kind === 'offline') return { ...CLEAN, offline: true, fetched, tooBig }
  return { ...CLEAN, attention: { kind: failure.kind, detail: failure.detail }, fetched, tooBig }
}

/** How many times a rebase is tried while saves keep landing under it (D30). */
const REBASE_TRIES = 3

/**
 * `git rebase <args>`, same-file conflicts kept both (D6), held-back files parked around it. Null
 * when it landed, else the verdict.
 *
 * git will not rebase over a tracked file saved after the pass's commit, and the fetch in between
 * takes seconds. So every try commits what is there and rebases at once (D30): a late save replays
 * with the rest, keep-both included, and is never stashed. After the last try the commit decides:
 * nothing new means the rebase failed for another reason — git's own words; a tree still being
 * written is not a problem to show anyone (D31) — its saves are committed and the next pass
 * replays them.
 */
export async function rebaseKeepingBoth(bin: string, root: string, host: string, args: string[]): Promise<Verdict | null> {
  let failed: GitResult | null = null
  for (let left = REBASE_TRIES; ; left -= 1) {
    // D16, asked again: the user may have started a merge or a rebase since the pass began.
    const { busy } = await repoState(bin, root)
    if (busy !== null) return { ...CLEAN, attention: { kind: 'busy-repo', detail: busy }, fetched: true }
    const late = await commitPending(bin, root, host)
    if (late.failed !== null) return fromFailure(late.failed, late.tooBig, true)
    if (left === 0) return failed !== null && !late.committed ? fromFailure(failed, late.tooBig, true) : { ...CLEAN, fetched: true, tooBig: late.tooBig }
    failed = await parkWhileRebasing(bin, root, late.tooBig, async () => {
      const rebased = await git(bin, root, ['rebase', ...args])
      if (rebased.code === 0) return null
      // Refused before it began (a save under it): nothing to settle or abort, and the save stays as it is on disk.
      if ((await repoState(bin, root)).busy !== 'rebase') return rebased
      return (await resolveRebase(bin, root, host)) ? null : rebased
    })
    if (failed === null) return null
  }
}

/** Our commits GitHub does not have yet. Asked after a rebase, which may have committed a late save (D30). */
export const countAhead = async (bin: string, root: string): Promise<number> => Number.parseInt((await git(bin, root, ['rev-list', '--count', '@{u}..HEAD'])).stdout, 10) || 0

/**
 * The one stash. A held-back TRACKED file is still modified after the commit, and `git rebase`
 * refuses to run over an unstaged change. So exactly those files are parked, the rebase runs, and
 * their bytes are copied back from the stash and the stash dropped — whether the rebase landed or
 * not. A copy, never a merge: it cannot conflict. Answers `rebase()`'s failure (null = landed), or
 * the git failure that stopped the park.
 *
 * `stash push` exits 0 even when it saved nothing (the file was reverted since it was listed), so
 * the stash is only restored and dropped when `refs/stash` moved to a new entry — the user's own
 * stashes are never touched.
 */
async function parkWhileRebasing(bin: string, root: string, tooBig: readonly TooBigFile[], rebase: () => Promise<GitResult | null>): Promise<GitResult | null> {
  const tracked = tooBig.length === 0 ? [] : zList(await git(bin, root, ['ls-files', '-z', '--', ...tooBig.map((f) => `:(literal)${f.path}`)]))
  if (tracked.length === 0) return rebase()
  const specs = tracked.map((p) => `:(literal)${p}`)
  const before = await stashTop(bin, root)
  const parked = await git(bin, root, ['stash', 'push', '-q', '-m', 'autosync: held back while rebasing', '--', ...specs])
  if (parked.code !== 0) return parked
  const ours = await stashTop(bin, root)
  if (ours === before) return rebase()
  try {
    return await rebase()
  } finally {
    await git(bin, root, ['checkout', ours, '--', ...specs])
    await git(bin, root, ['reset', '-q', '--', ...specs])
    if ((await stashTop(bin, root)) === ours) await git(bin, root, ['stash', 'drop', '-q'])
  }
}

/** The newest stash entry's sha, or '' when there is none. */
async function stashTop(bin: string, root: string): Promise<string> {
  return (await git(bin, root, ['rev-parse', '-q', '--verify', 'refs/stash'])).stdout.trim()
}
