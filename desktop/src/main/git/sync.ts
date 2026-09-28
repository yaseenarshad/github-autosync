// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/sync.ts; changes: AutoSync result shape, busy-repo refusal, keep-both resolve, host in the subject, 95 MiB line with sizes, no .DS_Store/.gitignore edits, post-pass facts.
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Attention, ConflictPair, FileChange, OtherApp, TooBigFile } from '@shared/types'
import { classifyGitFailure, findGit, firstMeaningfulLine, git, zList, type GitResult } from './exec'
import { isRepoRoot, otherApp, readConflicts, readIgnored, readPending, repoState, type RepoState } from './detect'
import { resolveRebase } from './resolve'

/**
 * One sync pass: "make this folder and its GitHub remote agree", as a single async function of a
 * folder that never throws. `manager.ts` owns WHEN a pass runs; this owns what it does.
 *
 * The order is fixed and load-bearing — commit, fetch, rebase, push:
 *   - COMMIT FIRST so the rebase has a clean tree to move. Nothing here ever stashes the user's
 *     work, with one exception (`parkWhileRebasing`): a tracked file held back as too big.
 *   - REBASE, never merge: two computers editing different files replay cleanly and the history
 *     stays one line anyone can read on GitHub. Same-file conflicts keep both copies (`resolve.ts`).
 *   - A repo someone is in the middle of (rebase, merge, detached HEAD) is never touched (D16).
 *
 * Every failure is CLASSIFIED rather than thrown: offline is not the user's problem (retry
 * quietly), auth and identity are (say so once), anything else is shown verbatim.
 */

/** GitHub refuses a push with any blob over 100 MiB; 95 leaves headroom for a file that is still growing (D11). */
export const TOO_BIG_BYTES = 95 * 1024 * 1024

/** A stalled transfer, not a slow one: a big folder over a home uplink can take minutes and must not restart from zero every 30 s. */
export const TRANSFER_TIMEOUT_MS = 10 * 60_000

/** Quitting never waits on a half-dead network for longer than this. */
const FLUSH_PUSH_TIMEOUT_MS = 5_000

/** How many file names a commit subject lists before it summarises the rest. */
const SUBJECT_FILES = 3

/** This computer's name in commit subjects and conflict copies (D16): macOS's `.local` suffix is noise. */
export const hostName = (raw: string = os.hostname()): string => raw.replace(/\.local$/i, '')

/** `sync (Mac-A): a.md, b.md, c.md +2 more`, or a bare `sync (Mac-A)`. Basenames — a subject is a glance; the paths are in the diff. */
export function commitMessage(host: string, files: readonly string[]): string {
  const names = files.map((f) => path.posix.basename(f)).filter((n) => n !== '')
  if (names.length === 0) return `sync (${host})`
  const rest = names.length - SUBJECT_FILES
  const head = names.slice(0, SUBJECT_FILES).join(', ')
  return rest > 0 ? `sync (${host}): ${head} +${rest} more` : `sync (${host}): ${head}`
}

export interface PassOptions {
  host: string
  /** The quit variant: commit, then a short-capped push — no fetch, no rebase. */
  flush?: boolean
  /** Test seam: where to look for git. */
  candidates?: readonly string[]
  /** Told once the pass knows whether it is receiving (`down`) or sending (`up`). */
  onDirection?: (direction: 'up' | 'down') => void
}

/** Everything the status shows that a pass re-reads when it ends. */
interface Facts {
  branch: string | null
  remoteUrl: string | null
  pending: FileChange[]
  ignored: { patterns: string[]; count: number }
  conflicts: ConflictPair[]
}

export interface PassResult {
  /** The pass's own verdict, else the derived conflict attention, else null. */
  attention: Attention | null
  offline: boolean
  /** `fetch` succeeded → lastCheckedAt. */
  fetched: boolean
  /** Ended level with origin → lastSyncedAt, and the idle poll may run. */
  level: boolean
  tooBig: TooBigFile[]
  alsoSyncedBy: OtherApp | null
  /** Null when git could not read the folder at all. */
  facts: Facts | null
}

type Verdict = Pick<PassResult, 'attention' | 'offline' | 'fetched' | 'level' | 'tooBig'>

const CLEAN: Verdict = { attention: null, offline: false, fetched: false, level: false, tooBig: [] }

export async function syncFolder(root: string, opts: PassOptions): Promise<PassResult> {
  const bin = await findGit(opts.candidates)
  if (bin === null) return { ...CLEAN, attention: { kind: 'no-git' }, alsoSyncedBy: null, facts: null }
  // Moved, deleted, or its `.git` removed: nothing to read and nothing to write.
  if (!isRepoRoot(root)) {
    return { ...CLEAN, attention: { kind: 'error', detail: `fatal: not a git repository: ${root}` }, alsoSyncedBy: null, facts: null }
  }
  const alsoSyncedBy = await otherApp(root)
  const repo = await repoState(bin, root)
  const verdict = await pass(bin, root, repo, opts)
  const facts = await readFacts(bin, root, repo)
  const conflict: Attention | null = facts.conflicts.length > 0 ? { kind: 'conflict', conflicts: facts.conflicts } : null
  return { ...verdict, attention: verdict.attention ?? conflict, alsoSyncedBy, facts }
}

async function readFacts(bin: string, root: string, repo: RepoState): Promise<Facts> {
  return {
    branch: repo.branch,
    remoteUrl: repo.remoteUrl,
    pending: await readPending(bin, root),
    ignored: await readIgnored(bin, root),
    conflicts: await readConflicts(bin, root),
  }
}

/** offline → quiet retry; auth / identity → the user's to fix; anything else → git's own words. */
function fromFailure(res: GitResult, tooBig: TooBigFile[], fetched = false): Verdict {
  const kind = classifyGitFailure(res)
  if (kind === 'offline') return { ...CLEAN, offline: true, fetched, tooBig }
  if (kind === 'identity') return { ...CLEAN, attention: { kind: 'no-identity' }, fetched, tooBig }
  return { ...CLEAN, attention: { kind: kind === 'auth' ? 'auth' : 'error', detail: firstMeaningfulLine(res) }, fetched, tooBig }
}

async function pass(bin: string, root: string, repo: RepoState, opts: PassOptions): Promise<Verdict> {
  // D16: zero writes — not even `add` — into a repo someone else is in the middle of.
  if (repo.busy !== null) return { ...CLEAN, attention: { kind: 'busy-repo', detail: repo.busy } }
  if (repo.remoteUrl === null) return { ...CLEAN, attention: { kind: 'error', detail: "error: No such remote 'origin'" } }

  // ---------- 1. local edits become one commit (minus anything GitHub would refuse — D11) ----------
  const staging = await stageWithinLimit(bin, root)
  const tooBig = staging.tooBig
  if (staging.failed !== null) return fromFailure(staging.failed, tooBig)
  const staged = zList(await git(bin, root, ['diff', '--cached', '--name-only', '-z']))
  if (staged.length > 0) {
    const committed = await git(bin, root, ['commit', '-m', commitMessage(opts.host, staged)])
    if (committed.code !== 0) return fromFailure(committed, tooBig)
  }

  return exchange(bin, root, tooBig, opts, true)
}

/**
 * Another computer's push landing between our fetch and our push: `[rejected] (fetch first)` when it
 * landed before ours started, `cannot lock ref` / `incorrect old value` when the two were in flight
 * together. Either way git refused ours without touching anything.
 */
const PUSH_RACED = /\[rejected\]|non-fast-forward|fetch first|cannot lock ref|incorrect old value/i

/**
 * Fetch → rebase → push. `mayRetry`: a push that lost the race to another computer's is not a
 * problem to show anyone — the exchange simply runs once more against the newer upstream.
 */
async function exchange(bin: string, root: string, tooBig: TooBigFile[], opts: PassOptions, mayRetry: boolean): Promise<Verdict> {
  // ---------- 2. learn what GitHub has (skipped on the quit flush) ----------
  const flush = opts.flush === true
  if (!flush) {
    const fetched = await git(bin, root, ['fetch', 'origin'], { timeoutMs: TRANSFER_TIMEOUT_MS })
    if (fetched.code !== 0) return fromFailure(fetched, tooBig)
  }

  // "<behind>\t<ahead>" in one call. Failing IS an answer: no upstream yet (never pushed), so
  // nothing to rebase onto and everything to push — if there is anything at all (an empty clone
  // of an empty GitHub repo has no HEAD commit to push).
  const counts = await git(bin, root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  const hasUpstream = counts.code === 0
  let behind = 0
  let ahead = 0
  if (hasUpstream) {
    const [b = '', a = ''] = counts.stdout.trim().split(/\s+/)
    behind = Number.parseInt(b, 10) || 0
    ahead = Number.parseInt(a, 10) || 0
  } else if ((await git(bin, root, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0) {
    ahead = 1
  }

  // ---------- 3. replay our commits on top of theirs; same-file conflicts keep both (D6) ----------
  if (behind > 0 && !flush) {
    opts.onDirection?.('down')
    const outcome = await parkWhileRebasing(bin, root, tooBig, async () => {
      const rebased = await git(bin, root, ['rebase', '@{u}'])
      if (rebased.code === 0 || (await resolveRebase(bin, root, opts.host))) return null
      return rebased
    })
    if (outcome !== null) return fromFailure(outcome, tooBig, true)
  }

  // ---------- 4. publish ----------
  if (ahead > 0) {
    opts.onDirection?.('up')
    const pushed = await git(bin, root, hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { timeoutMs: flush ? FLUSH_PUSH_TIMEOUT_MS : TRANSFER_TIMEOUT_MS })
    if (pushed.code !== 0 && mayRetry && !flush && PUSH_RACED.test(pushed.stderr)) return exchange(bin, root, tooBig, opts, false)
    if (pushed.code !== 0) return fromFailure(pushed, tooBig, !flush)
  }
  return { ...CLEAN, fetched: !flush, level: !flush, tooBig }
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
  const staged = await git(bin, root, ['add', '-A', '--', '.', ...held.map((f) => `:(exclude,literal)${f.path}`)])
  if (staged.code !== 0) return { failed: staged, tooBig: held }
  const late = await oversize(root, zList(await git(bin, root, ['diff', '--cached', '--name-only', '-z'])))
  if (late.length > 0) await git(bin, root, ['reset', '-q', '--', ...late.map((f) => `:(literal)${f.path}`)])
  const all = new Map([...held, ...late].map((f) => [f.path, f]))
  return { failed: null, tooBig: [...all.values()].sort((a, b) => a.path.localeCompare(b.path)) }
}

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

/** The pending list alone, for the manager's look between passes; null when git cannot read the folder. */
export async function peekPending(root: string, candidates?: readonly string[]): Promise<FileChange[] | null> {
  const bin = await findGit(candidates)
  if (bin === null || !isRepoRoot(root)) return null
  return readPending(bin, root)
}
