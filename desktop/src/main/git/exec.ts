// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/exec.ts; changes: GIT_EDITOR=true, `findGit`, no stdin `input`, failure classification moved here from sync.ts (+ identity), extra `env` (gh, D28).
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Git runner — the one place this app starts a child process (`gh` runs through it too, D28).
 *
 * A packaged app has no developer `PATH`, so the binary is an EXPLICIT absolute path picked from a
 * fixed candidate list (never a `PATH` lookup), `execFile` runs it with no shell, and the caller
 * assembles argv; nothing is interpolated into a string.
 *
 * Non-zero exits are DATA, not failures — "no origin", "nothing to commit", "auth rejected" are
 * all normal states of a sync pass and each caller classifies them differently. Only a
 * spawn-level failure (no such binary, no permission, a folder that no longer exists) rejects.
 */

/**
 * Where each OS keeps git, in the order we prefer it.
 *
 *   - darwin: Apple's Command Line Tools shim, then Homebrew. Presence is not proof it WORKS — on a
 *     Mac without the CLT, `/usr/bin/git` is a shim that exits non-zero (`findGit` checks).
 *   - win32: Git for Windows, machine-wide (`%ProgramFiles%`, legacy 32-bit prefix) or per-user
 *     (`%LOCALAPPDATA%\Programs`); `cmd\git.exe` is the launcher meant for outside callers.
 *   - anything else (Linux): the distro package and the source-install prefix.
 */
export function gitCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (platform === 'darwin') return ['/usr/bin/git', '/opt/homebrew/bin/git']
  if (platform === 'win32') {
    const out: string[] = []
    const prefixes = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]
    for (const prefix of prefixes) {
      if (prefix === undefined || prefix === '') continue
      out.push(path.join(prefix, 'Git', 'cmd', 'git.exe'), path.join(prefix, 'Git', 'bin', 'git.exe'))
    }
    return out
  }
  return ['/usr/bin/git', '/usr/local/bin/git']
}

export const GIT_CANDIDATES: readonly string[] = gitCandidates()

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** `code` when the run was killed for exceeding its timeout. Negative, so it can never collide with a git exit status. */
export const GIT_TIMEOUT_CODE = -1

/** Short enough that a wedged child can't hang a sync pass forever; transfers pass their own budget. */
const DEFAULT_TIMEOUT_MS = 30_000

/** `git status` on a large repo is still kilobytes; 10 MB is a runaway guard, not a working limit. */
const MAX_BUFFER = 10 * 1024 * 1024

/**
 * First candidate that exists as a file, else null. Deliberately uncached: a cache would keep
 * answering "no git" after the user installs it. `stat` follows symlinks (Homebrew's Cellar link).
 */
export async function resolveGit(candidates: readonly string[] = GIT_CANDIDATES): Promise<string | null> {
  for (const bin of candidates) {
    const st = await stat(bin).catch(() => null)
    if (st?.isFile() === true) return bin
  }
  return null
}

/** A git that ran, per candidate list. Only a hit is kept — "no git" is re-asked every time, so installing it is noticed. */
const working = new WeakMap<readonly string[], string>()

/**
 * A git that actually runs: the macOS CLT shim exists without the tools and fails every command.
 * Once one has run, later calls only re-`stat` it (no spawn), so an uninstall is still noticed.
 */
export async function findGit(candidates: readonly string[] = GIT_CANDIDATES): Promise<string | null> {
  const known = working.get(candidates)
  if (known !== undefined && (await stat(known).catch(() => null))?.isFile() === true) return known
  working.delete(candidates)
  const bin = await resolveGit(candidates)
  if (bin === null) return null
  const version = await git(bin, path.parse(process.cwd()).root, ['--version']).catch(() => null)
  if (version?.code !== 0) return null
  working.set(candidates, bin)
  return bin
}

/**
 * Runs git at the EXPLICIT binary path `bin` inside `root`. Resolves with the exit code — a
 * non-zero exit NEVER throws. On timeout the child is killed and the result resolves with
 * `GIT_TIMEOUT_CODE` and a `timed out` line in stderr, so a wedged git looks like any other
 * classifiable failure.
 */
export function git(bin: string, root: string, args: string[], opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<GitResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        cwd: root,
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
        // Merged over the inherited environment — git still needs HOME (its config, credential
        // helpers) and the proxy vars. GIT_TERMINAL_PROMPT=0 makes a missing credential fail fast
        // instead of blocking on a prompt no one can answer. GIT_OPTIONAL_LOCKS=0 keeps read-only
        // calls (`status`) from writing the index, so a status read never fights the user's own
        // terminal for `.git/index.lock`. GIT_EDITOR=true: a background app has no one to type a
        // message, so `rebase --continue` takes the one it has (and beats a user's own GIT_EDITOR).
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_EDITOR: 'true', ...opts.env },
      },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ code: 0, stdout, stderr })
          return
        }
        // A non-zero exit carries a numeric `code`; a spawn failure an errno STRING ('ENOENT'); a
        // killed child null. That three-way split is the whole classification.
        const code: unknown = (err as NodeJS.ErrnoException).code
        if (typeof code === 'number') {
          resolve({ code, stdout, stderr })
          return
        }
        if (code === null || code === undefined) {
          const note = `git: timed out after ${timeout}ms`
          resolve({ code: GIT_TIMEOUT_CODE, stdout, stderr: stderr === '' ? note : `${stderr.trimEnd()}\n${note}` })
          return
        }
        reject(err)
      },
    )
  })
}

/** One `-z` listing as paths; a failed listing is an empty one. */
export const zList = (res: GitResult): string[] => (res.code === 0 ? res.stdout.split('\0').filter((p) => p !== '') : [])

/**
 * Auth is checked BEFORE offline: git wraps almost every remote failure — expired token included —
 * in the generic `unable to access` / `Could not read from remote repository` envelope, so an
 * offline-first check would file a dead SSH key as "no network" and retry it silently forever.
 * `403` is matched on a word boundary so an abbreviated SHA like `1a403bc` can't pass for one.
 */
const AUTH_PATTERNS = [/authentication failed/i, /permission denied/i, /publickey/i, /could not read username/i, /terminal prompts disabled/i, /\b403\b/]

const OFFLINE_PATTERNS = [/could not resolve host/i, /unable to access/i, /could not read from remote repository/i, /connection refused/i, /connection timed out/i, /network is unreachable/i]

/** git's own way of saying "I don't know who you are" — the hint block names `user.name`. */
const IDENTITY_PATTERNS = [/tell me who you are/i, /empty ident/i, /user\.name/i]

/**
 * Which kind of failure a non-zero run is. Pure, so it is tested against real git output without a
 * network. A timeout counts as offline: credential prompts already fail fast
 * (`GIT_TERMINAL_PROMPT=0`), so a run that hits its wall is a stalled transfer, not a lock.
 */
export function classifyGitFailure(res: GitResult): 'offline' | 'auth' | 'identity' | 'other' {
  if (res.code === GIT_TIMEOUT_CODE) return 'offline'
  const text = `${res.stderr}\n${res.stdout}`
  if (AUTH_PATTERNS.some((p) => p.test(text))) return 'auth'
  if (OFFLINE_PATTERNS.some((p) => p.test(text))) return 'offline'
  if (IDENTITY_PATTERNS.some((p) => p.test(text))) return 'identity'
  return 'other'
}

/** git's own `fatal:`/`error:` line when there is one, else the first non-blank line — progress chatter and hint epilogues are noise. */
export function firstMeaningfulLine(res: GitResult): string {
  const lines = `${res.stderr}\n${res.stdout}`
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  return lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[0] ?? `git exited ${res.code}`
}
