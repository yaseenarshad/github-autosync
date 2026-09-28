// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/detect.test.ts; changes: rewritten for AutoSync's reads (busy repo, pending, ignored, conflict copies, web URL, Docs/Draw marker, checkFolder verdicts).
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { git } from './exec'
import { checkFolder, otherApp, readConflicts, readIgnored, readPending, repoState, webUrlOf } from './detect'
import { clone, makeBareRemote, makeGitRepo, pushedRepo, REAL_GIT_TIMEOUT_MS, requireGit, tempDir, wireOrigin, type GitRepo } from './gitFixture'

// Real git throughout; the spy only lets one test fake GitHub's answer to `ls-remote`.
vi.mock('./exec', async (actual) => {
  const mod = await actual<typeof import('./exec')>()
  return { ...mod, git: vi.fn(mod.git) }
})

let bin: string
beforeAll(async () => {
  bin = await requireGit()
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.mocked(git).mockClear()
  for (const c of cleanups.splice(0)) await c()
})

async function committedRepo(): Promise<GitRepo> {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('a.md', '# a\n')
  await repo.run(['add', 'a.md'])
  await repo.run(['commit', '-m', 'init'])
  return repo
}

async function pushed(): Promise<GitRepo> {
  const { repo, cleanup } = await pushedRepo()
  cleanups.push(cleanup)
  return repo
}

describe('repoState', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('reads origin and branch of a quiet repo', async () => {
    const repo = await pushed()
    expect(await repoState(bin, repo.root)).toEqual({ remoteUrl: expect.stringContaining('autosync-remote-'), branch: 'main', busy: null })
  })

  it('names the unborn branch of a zero-commit repo and reports no origin', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    expect(await repoState(bin, repo.root)).toEqual({ remoteUrl: null, branch: 'main', busy: null })
  })

  it('reports a detached HEAD as busy', async () => {
    const repo = await committedRepo()
    await repo.run(['checkout', '-q', '--detach', 'HEAD'])
    expect((await repoState(bin, repo.root)).busy).toBe('detached')
  })

  it('reports a stopped rebase and an unfinished merge as busy', async () => {
    const repo = await committedRepo()
    await repo.run(['checkout', '-q', '-b', 'side'])
    await repo.write('a.md', '# side\n')
    await repo.run(['commit', '-qam', 'side'])
    await repo.run(['checkout', '-q', 'main'])
    await repo.write('a.md', '# main\n')
    await repo.run(['commit', '-qam', 'main'])

    expect((await git(bin, repo.root, ['merge', 'side'])).code).not.toBe(0)
    expect((await repoState(bin, repo.root)).busy).toBe('merge')
    await repo.run(['merge', '--abort'])

    expect((await git(bin, repo.root, ['rebase', 'side'])).code).not.toBe(0)
    expect((await repoState(bin, repo.root)).busy).toBe('rebase')
  })
})

describe('readPending', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('lists working-tree changes file by file, untracked as adds, a staged rename as R', async () => {
    const repo = await pushed()
    await repo.write('gone.md', 'x\n')
    await repo.write('old name.md', 'rename me\n')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'setup'])
    await repo.run(['push', '-q'])
    await repo.write('new dir/deep/one.md', '1\n')
    await repo.write('new dir/two.md', '2\n')
    await repo.write('note.md', 'edited\n')
    await rm(path.join(repo.root, 'gone.md'))
    await repo.run(['mv', 'old name.md', 'new name.md'])

    const pending = await readPending(bin, repo.root)

    expect(new Map(pending.map((c) => [c.path, c.status]))).toEqual(
      new Map([
        ['new dir/deep/one.md', 'A'],
        ['new dir/two.md', 'A'],
        ['note.md', 'M'],
        ['gone.md', 'D'],
        ['new name.md', 'R'],
      ]),
    )
  })

  it('includes committed-but-unpushed files, deduped against the working tree', async () => {
    const repo = await pushed()
    await repo.write('sent.md', 'committed\n')
    await repo.write('note.md', 'committed edit\n')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'local'])
    await repo.write('note.md', 'edited again\n')

    const pending = await readPending(bin, repo.root)

    expect(pending).toHaveLength(2)
    expect(pending).toEqual(expect.arrayContaining([{ status: 'A', path: 'sent.md' }, { status: 'M', path: 'note.md' }]))
  })

  it('is empty for a clean, pushed repo', async () => {
    expect(await readPending(bin, (await pushed()).root)).toEqual([])
  })
})

describe('readIgnored', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('lists the top-level patterns (no comments, no blanks) and counts what git ignores', async () => {
    const repo = await committedRepo()
    await repo.write('.gitignore', '# build output\nnode_modules/\n\n*.log\n')
    await repo.write('a.log', 'x')
    await repo.write('b.log', 'x')
    await repo.write('node_modules/pkg/index.js', 'x')
    expect(await readIgnored(bin, repo.root)).toEqual({ patterns: ['node_modules/', '*.log'], count: 3 })
  })

  it('caps the listed patterns at 20', async () => {
    const repo = await committedRepo()
    await repo.write('.gitignore', Array.from({ length: 30 }, (_, i) => `p${i}`).join('\n'))
    expect((await readIgnored(bin, repo.root)).patterns).toHaveLength(20)
  })

  it('is empty without a .gitignore', async () => {
    expect(await readIgnored(bin, (await committedRepo()).root)).toEqual({ patterns: [], count: 0 })
  })
})

describe('readConflicts', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('pairs each TRACKED keep-both copy with its original, numbered and extensionless ones included', async () => {
    const repo = await committedRepo()
    await repo.write('a (conflict Mac-B, 2026-09-27).md', 'x')
    await repo.write('docs/Plan (conflict Mac-A, 2026-09-27 2).txt', 'x')
    await repo.write('Makefile (conflict Mac-A, 2026-01-02)', 'x')
    await repo.write('untracked (conflict Mac-A, 2026-01-02).md', 'x')
    await repo.write('a (conflict about naming).md', 'not a copy')
    await repo.run(['add', 'a (conflict Mac-B, 2026-09-27).md', 'docs', 'Makefile (conflict Mac-A, 2026-01-02)', 'a (conflict about naming).md'])

    expect(await readConflicts(bin, repo.root)).toEqual([
      { original: 'Makefile', copy: 'Makefile (conflict Mac-A, 2026-01-02)' },
      { original: 'a.md', copy: 'a (conflict Mac-B, 2026-09-27).md' },
      { original: 'docs/Plan.txt', copy: 'docs/Plan (conflict Mac-A, 2026-09-27 2).txt' },
    ])
  })
})

describe('webUrlOf', () => {
  it.each([
    ['https://github.com/yaseen/notes.git', 'https://github.com/yaseen/notes'],
    ['https://github.com/yaseen/notes', 'https://github.com/yaseen/notes'],
    ['https://token@github.com/yaseen/notes.git', 'https://github.com/yaseen/notes'],
    ['https://user:pass@github.com/yaseen/notes/', 'https://github.com/yaseen/notes'],
    ['git@github.com:yaseen/notes.git', 'https://github.com/yaseen/notes'],
    ['ssh://git@github.com/yaseen/my.repo.git', 'https://github.com/yaseen/my.repo'],
  ])('%s → %s', (url, web) => {
    expect(webUrlOf(url)).toBe(web)
  })

  it.each([null, '/tmp/bare-remote', 'https://gitlab.com/yaseen/notes.git', 'https://github.com/yaseen', 'git@github.com.evil.com:x/y.git'])('%s → null', (url) => {
    expect(webUrlOf(url)).toBeNull()
  })
})

describe('otherApp', () => {
  it('names the Docs or Draw app only when its switch is exactly `enabled: true`', async () => {
    const dir = await tempDir('marker')
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    expect(await otherApp(dir)).toBeNull()
    await mkdir(path.join(dir, '.yaseendraw'))
    await writeFile(path.join(dir, '.yaseendraw', 'github.json'), '{"enabled":"true"}')
    expect(await otherApp(dir)).toBeNull()
    await writeFile(path.join(dir, '.yaseendraw', 'github.json'), '{"enabled":true}')
    expect(await otherApp(dir)).toBe('Draw')
    await mkdir(path.join(dir, '.yaseendocs'))
    await writeFile(path.join(dir, '.yaseendocs', 'github.json'), '{not json')
    expect(await otherApp(dir)).toBe('Draw')
    await writeFile(path.join(dir, '.yaseendocs', 'github.json'), '{"enabled":true}')
    expect(await otherApp(dir)).toBe('Docs')
  })
})

describe('checkFolder (D12/D2)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('no-git when there is no working git', async () => {
    expect(await checkFolder('/anywhere', [], [])).toEqual({ ok: false, path: '/anywhere', reason: 'no-git' })
  })

  it('not-git for a plain folder', async () => {
    const dir = await tempDir('plain')
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    expect(await checkFolder(dir, [])).toEqual({ ok: false, path: dir, reason: 'not-git' })
  })

  it('not-root for a folder inside a repo, naming the root', async () => {
    const repo = await committedRepo()
    await mkdir(path.join(repo.root, 'sub'))
    expect(await checkFolder(path.join(repo.root, 'sub'), [])).toEqual({ ok: false, path: path.join(repo.root, 'sub'), reason: 'not-root', root: repo.root })
  })

  it('already-added before anything touches the network', async () => {
    const repo = await pushed()
    expect(await checkFolder(repo.root, [repo.root])).toEqual({ ok: false, path: repo.root, reason: 'already-added' })
  })

  it('no-origin for a repo nobody wired up', async () => {
    const repo = await committedRepo()
    expect(await checkFolder(repo.root, [])).toEqual({ ok: false, path: repo.root, reason: 'no-origin' })
  })

  it('ok for a reachable origin, with the other app named as a warning', async () => {
    const repo = await pushed()
    expect(await checkFolder(repo.root, [])).toEqual({ ok: true, path: repo.root, warning: null, offline: false })
    await repo.write('.yaseendocs/github.json', '{"enabled":true}')
    expect(await checkFolder(repo.root, [])).toEqual({ ok: true, path: repo.root, warning: 'Docs', offline: false })
  })

  it('ok but offline when origin cannot be reached', async () => {
    const repo = await committedRepo()
    await repo.run(['remote', 'add', 'origin', path.join(tmpdir(), 'autosync-no-such-remote')])
    expect(await checkFolder(repo.root, [])).toEqual({ ok: true, path: repo.root, warning: null, offline: true })
  })

  it('auth when GitHub turns the credentials down', async () => {
    const repo = await pushed()
    const real = vi.mocked(git).getMockImplementation() as typeof git
    vi.mocked(git).mockImplementation(async (b, root, args, opts) =>
      args[0] === 'ls-remote' ? { code: 128, stdout: '', stderr: "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/x/y.git/'" } : real(b, root, args, opts),
    )
    try {
      expect(await checkFolder(repo.root, [])).toEqual({ ok: false, path: repo.root, reason: 'auth' })
    } finally {
      vi.mocked(git).mockImplementation(real)
    }
  })

  it('a second computer’s clone checks out fine too', async () => {
    const remote = await makeBareRemote()
    cleanups.push(remote.cleanup)
    const a = await makeGitRepo()
    cleanups.push(a.cleanup)
    await a.write('x.md', 'x')
    await a.run(['add', '-A'])
    await a.run(['commit', '-qm', 'x'])
    await wireOrigin(a, remote)
    await a.run(['push', '-q', '-u', 'origin', 'HEAD'])
    const b = await clone(remote, 'Sam')
    cleanups.push(b.cleanup)
    expect((await checkFolder(b.root, [a.root])).ok).toBe(true)
  })
})
