import path from 'node:path'
import { firstMeaningfulLine, git, GIT_TIMEOUT_CODE, resolveBin, type GitResult } from './exec'
import { webUrlOf } from './detect'

/**
 * GitHub's side of PR publishing (D22, D23, D25, D28): what the repo requires and the PR in flight.
 * `sync.ts` only ever sees this seam; production runs the user's own `gh` (`ghCli`), the tests an
 * in-process fake that squash-merges into a bare remote (`gitFixture.ts`).
 *
 * Every call answers a result and never throws — like `git()`, a failure is data the pass classifies.
 */

/** What the repo's default branch demands; read from its rules, never a setting (D22, D29). */
export interface RepoPolicy {
  defaultBranch: string
  requiresPr: boolean
}

export interface PullRequest {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  /** GitHub computes this lazily: `UNKNOWN` just means "not yet". */
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

/** `no-gh`: not installed or not logged in. `offline` and `auth` mean what they mean for git. */
export interface GhFailure {
  kind: 'no-gh' | 'auth' | 'offline' | 'error'
  detail: string
}

export type GhResult<T> = { ok: true; value: T } | { ok: false; failure: GhFailure }

export interface GitHubRepo {
  policy(): Promise<GhResult<RepoPolicy>>
  /** The PR whose head is `branch`: an OPEN one if there is one (gh prefers it), else the newest in any state; null when there is none. */
  findPr(branch: string): Promise<GhResult<PullRequest | null>>
  createPr(pr: { head: string; base: string; title: string; body: string }): Promise<GhResult<PullRequest>>
  /** Closes with a comment and deletes the PR's branch. */
  closePr(number: number, comment: string): Promise<GhResult<void>>
}

export interface GitHub {
  /** Null when `remoteUrl` is not a GitHub repo — such a folder is always push mode. */
  repo(remoteUrl: string): GitHubRepo | null
}

/** Where each OS keeps gh — explicit paths, never a `PATH` lookup, for the reason `exec.ts` gives for git. */
export function ghCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (platform === 'darwin') return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']
  if (platform === 'win32') {
    const out: string[] = []
    if (env.ProgramFiles) out.push(path.join(env.ProgramFiles, 'GitHub CLI', 'gh.exe'))
    if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe'))
    return out
  }
  return ['/usr/bin/gh', '/usr/local/bin/gh']
}

/** One gh run; null when there is no gh to run. */
export type GhRun = (args: string[]) => Promise<GitResult | null>

/** A background app has no one to answer a prompt, read a pager or see colour; an update notice is noise on stderr. */
const GH_ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_PAGER: 'cat' }

const GH_CANDIDATES = ghCandidates()

/**
 * The user's own gh, in the filesystem root: every call names its repo with `-R` (or an API path),
 * so gh never reads — or, on `pr close --delete-branch`, touches — the local repo's branches.
 * Looked up on every call, like git, so installing gh is noticed without a restart.
 */
const runGh: GhRun = async (args) => {
  const bin = await resolveBin(GH_CANDIDATES)
  if (bin === null) return null
  // Only a missing gh is `no-gh`; one that exists but will not start (permissions, a broken install) is an error in its own words.
  return git(bin, path.parse(process.cwd()).root, args, { env: GH_ENV }).catch((err: unknown) => ({ code: 1, stdout: '', stderr: String(err) }))
}

const GH_OFFLINE = /error connecting|no such host|dial tcp|timeout|timed out/i

/** Missing or logged out → `no-gh`; the network or a rate limit → `offline`; a refused token → `auth`; else gh's own words. */
export function classifyGhFailure(res: GitResult | null): GhFailure {
  if (res === null) return { kind: 'no-gh', detail: 'GitHub CLI (gh) is not installed.' }
  const text = `${res.stderr}\n${res.stdout}`
  const detail = firstMeaningfulLine(res, 'gh')
  if (/gh auth login|not logged/i.test(text)) return { kind: 'no-gh', detail }
  // A rate limit (often a 403) passes with time: retry quietly rather than ask the user to sign in again.
  if (res.code === GIT_TIMEOUT_CODE || GH_OFFLINE.test(text) || /rate limit/i.test(text)) return { kind: 'offline', detail }
  if (/\b401\b|bad credentials|\b403\b/i.test(text)) return { kind: 'auth', detail }
  return { kind: 'error', detail }
}

/** A zero exit parsed by `parse`; output that will not parse is a failure too, never a throw. */
function answer<T>(res: GitResult | null, parse: (stdout: string) => T): GhResult<T> {
  if (res === null || res.code !== 0) return { ok: false, failure: classifyGhFailure(res) }
  try {
    return { ok: true, value: parse(res.stdout) }
  } catch {
    return { ok: false, failure: { kind: 'error', detail: `gh answered unexpectedly: ${firstMeaningfulLine(res, 'gh')}` } }
  }
}

/** `gh` as a `GitHub`, over any runner — production passes `runGh`, the tests a fake. */
export function ghGitHub(run: GhRun): GitHub {
  return {
    repo(remoteUrl) {
      const web = webUrlOf(remoteUrl)
      if (web === null) return null
      const slug = web.slice('https://github.com/'.length)
      const call = async <T>(args: string[], parse: (stdout: string) => T): Promise<GhResult<T>> => answer(await run(args), parse)
      return {
        async policy() {
          const branch = await call(['api', `repos/${slug}`, '--jq', '.default_branch'], (out) => out.trim())
          if (!branch.ok) return branch
          // The rules that apply to the branch, rulesets and all; a PR rule is one item of type `pull_request`.
          return call(['api', `repos/${slug}/rules/branches/${branch.value}`], (out) => ({
            defaultBranch: branch.value,
            requiresPr: (JSON.parse(out) as Array<{ type?: unknown }>).some((rule) => rule.type === 'pull_request'),
          }))
        },
        async findPr(branch) {
          const res = await run(['pr', 'view', branch, '-R', slug, '--json', 'number,url,state,mergeable'])
          // "no pull requests found for branch …" is an answer, not a failure.
          if (res !== null && res.code !== 0 && /no pull requests found/i.test(res.stderr)) return { ok: true, value: null }
          return answer(res, (out) => JSON.parse(out) as PullRequest)
        },
        createPr: ({ head, base, title, body }) =>
          call(['pr', 'create', '-R', slug, '--base', base, '--head', head, '--title', title, '--body', body], (out): PullRequest => {
            // gh prints the new PR's URL; its number is the last path segment.
            const url = /https:\/\/\S+\/pull\/(\d+)/.exec(out)
            if (url === null) throw new Error('no PR URL')
            return { number: Number(url[1]), url: url[0], state: 'OPEN', mergeable: 'UNKNOWN' }
          }),
        closePr: (number, comment) => call(['pr', 'close', String(number), '-R', slug, '--comment', comment, '--delete-branch'], () => undefined),
      }
    },
  }
}

/** D28: production GitHub — the user's own gh and its login. */
export const ghCli: GitHub = ghGitHub(runGh)
