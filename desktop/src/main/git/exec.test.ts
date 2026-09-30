// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/exec.test.ts (+ classifyGitFailure cases from sync.test.ts); changes: findGit, identity class, no installGitHint.
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { GIT_CANDIDATES, GIT_TIMEOUT_CODE, classifyGitFailure, findGit, firstMeaningfulLine, git, gitCandidates, resolveBin, type GitResult } from './exec'
import { requireGit, tempDir as makeTemp } from './gitFixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

/** A temp dir that is NOT a repo — `os.tmpdir()` is never inside one, so git calls in it fail predictably. */
async function tempDir(): Promise<string> {
  const dir = await makeTemp('exec')
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('resolveBin / findGit', () => {
  it('returns null when no candidate exists', async () => {
    expect(await resolveBin(['/nope/bin/git', '/also/nope/git'])).toBeNull()
    expect(await findGit(['/nope/bin/git'])).toBeNull()
  })

  it('ignores a candidate that is a directory rather than a binary', async () => {
    expect(await resolveBin([await tempDir()])).toBeNull()
  })

  it('finds this machine’s git among the defaults, and it runs', async () => {
    const bin = await findGit()
    expect(GIT_CANDIDATES).toContain(bin)
  })

  it('refuses a binary that exists but does not run git (the macOS CLT shim without the tools)', async () => {
    expect(await findGit(['/usr/bin/false'])).toBeNull()
  })
})

describe('gitCandidates', () => {
  it('on a Mac prefers the Command Line Tools shim, then Homebrew', () => {
    expect(gitCandidates('darwin')).toEqual(['/usr/bin/git', '/opt/homebrew/bin/git'])
  })

  it('on Windows lists Git for Windows under each install prefix, cmd launcher before bin', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }
    const norm = gitCandidates('win32', env).map((p) => p.replace(/\\/g, '/'))
    expect(norm).toEqual([
      'C:/Program Files/Git/cmd/git.exe',
      'C:/Program Files/Git/bin/git.exe',
      'C:/Program Files (x86)/Git/cmd/git.exe',
      'C:/Program Files (x86)/Git/bin/git.exe',
      'C:/Users/me/AppData/Local/Programs/Git/cmd/git.exe',
      'C:/Users/me/AppData/Local/Programs/Git/bin/git.exe',
    ])
  })

  it('never contains a bare name — every candidate is absolute, so nothing is ever a PATH lookup', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const p of gitCandidates(platform, { ProgramFiles: 'C:\\Program Files' })) expect(p).toMatch(/^(\/|[A-Z]:)/)
    }
  })
})

describe('git', () => {
  it('resolves a non-zero exit with stderr instead of rejecting', async () => {
    const res = await git(await requireGit(), await tempDir(), ['rev-parse', '--is-inside-work-tree'])
    expect(res.code).toBeGreaterThan(0)
    expect(res.stderr).toMatch(/not a git repository/i)
  })

  it('rejects with ENOENT for a bogus binary path — a spawn failure is not a git exit code', async () => {
    await expect(git('/definitely/not/a/git', await tempDir(), ['--version'])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never opens an editor: GIT_EDITOR is `true`', async () => {
    const res = await git(await requireGit(), await tempDir(), ['var', 'GIT_EDITOR'])
    expect(res.stdout.trim()).toBe('true')
  })

  // Windows: `cmd\git.exe` is a launcher; killing it may leave the real git holding the pipes (unverified there).
  it.skipIf(process.platform === 'win32')('kills a hung child on timeout and resolves -1', async () => {
    // `hash-object --stdin` blocks on a stdin pipe that is never closed: a reliably hanging git.
    const t0 = Date.now()
    const res = await git(await requireGit(), await tempDir(), ['hash-object', '--stdin'], { timeoutMs: 100 })
    expect(res.code).toBe(GIT_TIMEOUT_CODE)
    expect(res.stderr).toMatch(/timed out/)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

describe('classifyGitFailure', () => {
  const failed = (stderr: string, code = 128): GitResult => ({ code, stdout: '', stderr })

  it('calls a timeout offline', () => {
    expect(classifyGitFailure({ code: GIT_TIMEOUT_CODE, stdout: '', stderr: 'git: timed out after 30000ms' })).toBe('offline')
  })

  it.each([
    ["fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com", 'offline'],
    ['fatal: Could not read from remote repository.', 'offline'],
    ["fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com port 443: Connection refused", 'offline'],
    ['ssh: connect to host github.com port 22: Network is unreachable', 'offline'],
    ['remote: Support for password authentication was removed.\nfatal: Authentication failed for https://github.com/x/y.git/', 'auth'],
    ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'auth'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth'],
    ["fatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 403", 'auth'],
    ['Author identity unknown\n\n*** Please tell me who you are.\n\nfatal: unable to auto-detect email address', 'identity'],
    ['error: failed to push some refs to origin\nhint: Updates were rejected', 'other'],
  ])('classifies %s', (stderr, expected) => {
    expect(classifyGitFailure(failed(stderr))).toBe(expected)
  })

  it('does not mistake an abbreviated sha for an HTTP 403', () => {
    expect(classifyGitFailure(failed('error: failed to push some refs\n ! [rejected] 1a403bc..9f2c1de main -> main'))).toBe('other')
  })
})

describe('firstMeaningfulLine', () => {
  it("prefers git's own fatal/error line over chatter", () => {
    expect(firstMeaningfulLine({ code: 1, stdout: '', stderr: 'hint: something\nerror: could not apply 1234... note\nhint: more' })).toBe('error: could not apply 1234... note')
    expect(firstMeaningfulLine({ code: 1, stdout: '', stderr: '' })).toBe('git exited 1')
  })
})
