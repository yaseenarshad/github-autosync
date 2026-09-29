import type { PullRequestRef, TooBigFile } from '@shared/types'
import { findGit, git, zList } from './exec'
import type { GitHubRepo, PullRequest, RepoPolicy } from './github'
import { CLEAN, commitMessage, fromFailure, fromGhFailure, rebaseKeepingBoth, TRANSFER_TIMEOUT_MS, type Verdict } from './pass'
import type { PassOptions } from './sync'

/**
 * The PR route of a pass (D23): for a repo whose default branch takes changes only through pull
 * requests, each batch of commits leaves as its own branch and PR, and the repo's own Action
 * squash-merges it. The pass commits exactly as in push mode; only the exchange differs.
 *
 * One batch at a time. A LOCAL ref, `refs/autosync/in-flight`, marks the batch's head commit; it
 * is never pushed. Sending is three idempotent steps — set the ref, push the commit as
 * `autosync/<sha12>`, open the PR (`findPr` first) — so a pass that died between any two of them
 * finishes the send next time, and never opens a second PR. The batch's branch is immutable:
 * nothing is pushed to it again once its PR exists.
 *
 * While the ref exists the pass only checks the PR — no rebase, no push:
 *   - OPEN → wait; if it CONFLICTS with the branch (a teammate's batch landed first), close it,
 *     replay ours keep-both on top, and send that instead (D25).
 *   - MERGED → land it: the commits made since the batch are replayed onto the squash, the ref goes.
 *   - CLOSED by a human → ask the user (`pr-closed`); never re-sent on its own ("Send again").
 */

/** The batch in flight: its head commit, on this computer only. */
export const IN_FLIGHT = 'refs/autosync/in-flight'

/** D25: what the replaced PR says on GitHub. */
const REPLACED = 'Replaced by a newer batch from AutoSync: this one conflicted with main.'

/** One immutable branch per batch, named for its head commit. */
const branchOf = (sha: string): string => `autosync/${sha.slice(0, 12)}`

const refOf = (pr: PullRequest): PullRequestRef => ({ number: pr.number, url: pr.url })

/** D25 "Send again": drop the closed batch's marker. Its commits stay, so the next pass sends them as a fresh PR. */
export async function forgetInFlight(root: string): Promise<void> {
  const bin = await findGit()
  if (bin !== null) await git(bin, root, ['update-ref', '-d', IN_FLIGHT])
}

export async function exchangeViaPr(bin: string, root: string, gh: GitHubRepo, policy: RepoPolicy, tooBig: TooBigFile[], opts: PassOptions): Promise<Verdict> {
  // S13: quitting never waits on GitHub — the commit is made, the next start sends it.
  if (opts.flush === true) return { ...CLEAN, tooBig }
  // `--prune`: every merged batch deletes its branch; without it their remote-tracking refs pile up.
  const fetched = await git(bin, root, ['fetch', '--prune', 'origin'], { timeoutMs: TRANSFER_TIMEOUT_MS })
  if (fetched.code !== 0) return fromFailure(fetched, tooBig)
  const waiting = (pr: PullRequest | null): Verdict => ({ ...CLEAN, fetched: true, tooBig, pr: pr === null ? null : refOf(pr) })
  const publish = opts.publish !== false

  const batch = (await git(bin, root, ['rev-parse', '-q', '--verify', IN_FLIGHT])).stdout.trim()
  if (batch !== '') {
    const found = await gh.findPr(branchOf(batch))
    if (!found.ok) return fromGhFailure(found.failure, tooBig, true)
    const pr = found.value
    // S11: the pass that set the ref died before the PR was open.
    if (pr === null) return publish ? send(bin, root, gh, policy, batch, tooBig, opts) : waiting(null)
    if (pr.state === 'CLOSED') return { ...CLEAN, attention: { kind: 'pr-closed', detail: pr.url }, fetched: true, tooBig }
    if (pr.state === 'OPEN' && pr.mergeable !== 'CONFLICTING') return waiting(pr)
    if (pr.state === 'OPEN') {
      // Failing to close means it merged meanwhile: the next check lands it.
      if (!(await gh.closePr(pr.number, REPLACED)).ok) return waiting(pr)
    } else if ((await git(bin, root, ['merge-base', '--is-ancestor', batch, 'HEAD'])).code === 0) {
      // MERGED: the squash stands in for the batch; only what was committed since is ours to replay.
      opts.onDirection?.('down')
      const landed = await rebaseKeepingBoth(bin, root, opts.host, tooBig, ['--onto', '@{u}', batch])
      if (landed !== null) return fromFailure(landed, tooBig, true)
    }
    // S20: a batch no longer under HEAD (the user reset past it) is only forgotten — history is theirs.
    await git(bin, root, ['update-ref', '-d', IN_FLIGHT])
  }

  // Nothing in flight: receive, then send what is ours.
  const counts = await git(bin, root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  if (counts.code !== 0) return fromFailure(counts, tooBig, true)
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map((n) => Number.parseInt(n, 10) || 0)
  if (behind > 0) {
    opts.onDirection?.('down')
    const rebased = await rebaseKeepingBoth(bin, root, opts.host, tooBig, ['@{u}'])
    if (rebased !== null) return fromFailure(rebased, tooBig, true)
  }
  if (ahead === 0) return { ...waiting(null), level: true }
  // S10: commits that net to nothing (an edit undone) make no PR — folded away, the tree untouched.
  if ((await git(bin, root, ['diff', '--quiet', '@{u}', 'HEAD'])).code === 0) {
    const folded = await git(bin, root, ['reset', '-q', '--soft', '@{u}'])
    return folded.code === 0 ? { ...waiting(null), level: true } : fromFailure(folded, tooBig, true)
  }
  if (!publish) return waiting(null)
  const head = (await git(bin, root, ['rev-parse', 'HEAD'])).stdout.trim()
  return send(bin, root, gh, policy, head, tooBig, opts)
}

/** Set the ref → push the batch as its own branch → open its PR. Each step is safe to repeat. */
async function send(bin: string, root: string, gh: GitHubRepo, policy: RepoPolicy, batch: string, tooBig: TooBigFile[], opts: PassOptions): Promise<Verdict> {
  opts.onDirection?.('up')
  const branch = branchOf(batch)
  const marked = await git(bin, root, ['update-ref', IN_FLIGHT, batch])
  if (marked.code !== 0) return fromFailure(marked, tooBig, true)
  const pushed = await git(bin, root, ['push', 'origin', `${batch}:refs/heads/${branch}`], { timeoutMs: TRANSFER_TIMEOUT_MS })
  if (pushed.code !== 0) return fromFailure(pushed, tooBig, true)
  const found = await gh.findPr(branch)
  if (!found.ok) return fromGhFailure(found.failure, tooBig, true)
  // Only an OPEN one is this send's: a CLOSED one is what "Send again" is replacing.
  if (found.value?.state === 'OPEN') return { ...CLEAN, fetched: true, tooBig, pr: refOf(found.value) }
  // Three dots: the batch's own files, measured from where it left the branch.
  const files = zList(await git(bin, root, ['diff', '--name-only', '-z', `@{u}...${batch}`]))
  const created = await gh.createPr({ head: branch, base: policy.defaultBranch, title: commitMessage(opts.host, files), body: files.map((f) => `- ${f}`).join('\n') })
  if (!created.ok) return fromGhFailure(created.failure, tooBig, true)
  return { ...CLEAN, fetched: true, tooBig, pr: refOf(created.value) }
}
