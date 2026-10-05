// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/sync.ts; changes: AutoSync result shape, busy-repo refusal, keep-both resolve, host in the subject, 95 MiB line with sizes, no .DS_Store/.gitignore edits, post-pass facts, other-app refusal and the PR route (D22–D29; shared helpers moved to pass.ts).
import os from 'node:os'
import type { Attention, ConflictPair, FileChange, OtherApp, PullRequestRef, TooBigFile } from '@shared/types'
import { findGit, git } from './exec'
import { isRepoRoot, otherApp, readConflicts, readIgnored, readPending, repoState, type RepoState } from './detect'
import { ghCli, type GitHub, type RepoPolicy } from './github'
import { CLEAN, commitPending, fromFailure, fromGhFailure, rebaseKeepingBoth, TRANSFER_TIMEOUT_MS, type Verdict } from './pass'
import { exchangeViaPr } from './pullRequest'

/**
 * One sync pass: "make this folder and its GitHub remote agree", as a single async function of a
 * folder that never throws. `manager.ts` owns WHEN a pass runs; this owns what it does.
 *
 * The order is fixed and load-bearing — commit, fetch, rebase, push:
 *   - COMMIT FIRST so the rebase has a clean tree to move. Nothing here ever stashes the user's
 *     work, with one exception (`parkWhileRebasing`): a tracked file held back as too big.
 *   - REBASE, never merge: two computers editing different files replay cleanly and the history
 *     stays one line anyone can read on GitHub. Same-file conflicts keep both copies (`resolve.ts`).
 *   - A repo someone is in the middle of (rebase, merge, detached HEAD) is never touched (D16),
 *     nor one the Docs/Draw app syncs (D27).
 *   - HOW the commits reach GitHub is the repo's rules' call (D22): straight to the branch here,
 *     or one PR per batch when the default branch requires PRs (`pullRequest.ts`).
 *
 * Every failure is CLASSIFIED rather than thrown: offline is not the user's problem (retry
 * quietly), auth and identity are (say so once), anything else is shown verbatim.
 */

/** Quitting never waits on a half-dead network for longer than this. */
const FLUSH_PUSH_TIMEOUT_MS = 5_000

/** This computer's name in commit subjects and conflict copies (D16): macOS's `.local` suffix is noise. */
export const hostName = (raw: string = os.hostname()): string => raw.replace(/\.local$/i, '')

export interface PassOptions {
  host: string
  /** The quit variant: commit, then a short-capped push — no fetch, no rebase. */
  flush?: boolean
  /** Test seam: where to look for git. */
  candidates?: readonly string[]
  /** Told once the pass knows whether it is receiving (`down`) or sending (`up`). */
  onDirection?: (direction: 'up' | 'down') => void
  /** GitHub's side of PR publishing (D28); the user's gh unless a test brings its own. */
  github?: GitHub
  /** The repo's rules as last read (the manager keeps them); unknown → this pass reads them (D22). */
  policy?: RepoPolicy | null
  /** False on quiet passes: in PR mode they may land a merged batch and receive, never send (D24). */
  publish?: boolean
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
  /** The repo's rules as this pass knew them; null = unknown (not GitHub, or gh could not say), never cached. */
  policy: RepoPolicy | null
  /** The batch's PR while it is open (D26). */
  pr: PullRequestRef | null
}

export async function syncFolder(root: string, opts: PassOptions): Promise<PassResult> {
  const bin = await findGit(opts.candidates)
  if (bin === null) return { ...CLEAN, attention: { kind: 'no-git' }, alsoSyncedBy: null, facts: null }
  // Moved, deleted, or its `.git` removed: nothing to read and nothing to write.
  if (!isRepoRoot(root)) {
    return { ...CLEAN, attention: { kind: 'error', detail: `fatal: not a git repository: ${root}` }, alsoSyncedBy: null, facts: null }
  }
  const alsoSyncedBy = await otherApp(root)
  const repo = await repoState(bin, root)
  const verdict = await pass(bin, root, repo, alsoSyncedBy, opts)
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

/** D29: the branch is not the one the PR rule governs. */
const SIDE_BRANCH: Attention = { kind: 'busy-repo', detail: 'side-branch' }

async function pass(bin: string, root: string, repo: RepoState, alsoSyncedBy: OtherApp | null, opts: PassOptions): Promise<Verdict> {
  // D16: zero writes — not even `add` — into a repo someone else is in the middle of.
  if (repo.busy !== null) return { ...CLEAN, attention: { kind: 'busy-repo', detail: repo.busy } }
  // D27: two syncers on one folder would race each other's commits — the other app keeps it until its switch is off.
  if (alsoSyncedBy !== null) return { ...CLEAN, attention: { kind: 'other-app', detail: alsoSyncedBy } }
  if (repo.remoteUrl === null) return { ...CLEAN, attention: { kind: 'error', detail: "error: No such remote 'origin'" } }

  // D22: the rules pick the route. Unknown (not GitHub, or gh could not say) is push mode — as on
  // the quit flush, which never waits on GitHub to read them.
  const gh = (opts.github ?? ghCli).repo(repo.remoteUrl)
  let policy = gh === null ? null : (opts.policy ?? null)
  if (gh !== null && policy === null && opts.flush !== true) {
    const read = await gh.policy()
    if (read.ok) policy = read.value
  }
  // D29: a side branch of a PR-rule repo is someone's work in progress — zero writes.
  if (policy?.requiresPr === true && repo.branch !== policy.defaultBranch) return { ...CLEAN, attention: SIDE_BRANCH, policy }

  // ---------- 1. local edits become one commit (minus anything GitHub would refuse — D11) ----------
  const { failed, tooBig } = await commitPending(bin, root, opts.host)
  if (failed !== null) return fromFailure(failed, tooBig)

  if (gh !== null && policy?.requiresPr === true) return { ...(await exchangeViaPr(bin, root, gh, policy, tooBig, opts)), policy }
  const { needsPr, ...pushed } = await exchange(bin, root, tooBig, opts, true)
  if (needsPr !== true || gh === null || opts.flush === true) return { ...pushed, policy }

  // S6: a rule this pass did not know about refused the push — read the rules again and follow them now.
  const fresh = await gh.policy()
  if (!fresh.ok) return fromGhFailure(fresh.failure, tooBig, pushed.fetched)
  if (!fresh.value.requiresPr) return { ...pushed, policy: fresh.value }
  if (repo.branch !== fresh.value.defaultBranch) return { ...pushed, attention: SIDE_BRANCH, policy: fresh.value }
  return { ...(await exchangeViaPr(bin, root, gh, fresh.value, tooBig, opts)), policy: fresh.value }
}

/** GitHub refusing a push because a ruleset says the branch takes changes only through PRs (GH013). */
const NEEDS_PR = /GH013|through a pull request/i

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
async function exchange(bin: string, root: string, tooBig: TooBigFile[], opts: PassOptions, mayRetry: boolean): Promise<Verdict & { needsPr?: true }> {
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
    const outcome = await rebaseKeepingBoth(bin, root, opts.host, tooBig, ['@{u}'])
    if (outcome !== null) return fromFailure(outcome, tooBig, true)
  }

  // ---------- 4. publish ----------
  if (ahead > 0) {
    opts.onDirection?.('up')
    const pushed = await git(bin, root, hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { timeoutMs: flush ? FLUSH_PUSH_TIMEOUT_MS : TRANSFER_TIMEOUT_MS })
    if (pushed.code !== 0 && mayRetry && !flush && PUSH_RACED.test(pushed.stderr)) return exchange(bin, root, tooBig, opts, false)
    if (pushed.code !== 0 && NEEDS_PR.test(pushed.stderr)) return { ...fromFailure(pushed, tooBig, !flush), needsPr: true }
    if (pushed.code !== 0) return fromFailure(pushed, tooBig, !flush)
  }
  return { ...CLEAN, fetched: !flush, level: !flush, tooBig }
}

/** The pending list alone, for the manager's look between passes; null when git cannot read the folder. */
export async function peekPending(root: string, candidates?: readonly string[]): Promise<FileChange[] | null> {
  const bin = await findGit(candidates)
  if (bin === null || !isRepoRoot(root)) return null
  return readPending(bin, root)
}
