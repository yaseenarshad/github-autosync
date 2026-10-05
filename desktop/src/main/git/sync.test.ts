// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/sync.test.ts; changes: AutoSync result shape and subjects, busy-repo, identity, keep-both, empty clone, push race; .DS_Store cases dropped.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, rm, truncate, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { git } from './exec'
import { clone, makeBareRemote, makeGitRepo, pushedRepo as pushedFixture, REAL_GIT_TIMEOUT_MS, remoteHead, requireGit, shPath, wireOrigin, type BareRemote, type GitRepo } from './gitFixture'
import { commitMessage, TOO_BIG_BYTES, TRANSFER_TIMEOUT_MS } from './pass'
import { hostName, syncFolder, type PassOptions } from './sync'

// Real git throughout; the spy only records what each call was given.
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
  for (const c of cleanups.splice(0)) await c()
})

async function pushedRepo(): Promise<{ repo: GitRepo; remote: BareRemote }> {
  const fixture = await pushedFixture()
  cleanups.push(fixture.cleanup)
  return fixture
}

async function otherComputer(remote: BareRemote, name = 'Sam'): Promise<GitRepo> {
  const b = await clone(remote, name)
  cleanups.push(b.cleanup)
  return b
}

/** Commits and pushes `files` from another computer, subject in AutoSync's own shape. */
async function pushFrom(b: GitRepo, files: Record<string, string | Buffer>, host = 'Mac-B'): Promise<void> {
  for (const [rel, content] of Object.entries(files)) await b.write(rel, content)
  await b.run(['add', '-A'])
  await b.run(['commit', '-qm', `sync (${host})`])
  await b.run(['push', '-q'])
}

const pass = (repo: GitRepo, opts: Partial<PassOptions> = {}) => syncFolder(repo.root, { host: 'Mac-A', ...opts })

/** A file's SHA-1, streamed (the oversize files are 95 MiB, sparse). */
async function sha1(file: string): Promise<string> {
  const hash = createHash('sha1')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** A SPARSE file at `bytes`: `truncate` sets the size without writing a byte, so this costs nothing. */
async function oversize(repo: GitRepo, name: string, bytes = TOO_BIG_BYTES): Promise<void> {
  await repo.write(name, '')
  await truncate(path.join(repo.root, name), bytes)
}

describe('commitMessage / hostName (D16)', () => {
  it('names up to three basenames after the host, and falls back to a bare subject', () => {
    expect(commitMessage('Mac-A', [])).toBe('sync (Mac-A)')
    expect(commitMessage('Mac-A', ['notes/deep/one.md'])).toBe('sync (Mac-A): one.md')
    expect(commitMessage('Mac-A', ['a.md', 'b.md', 'c.md'])).toBe('sync (Mac-A): a.md, b.md, c.md')
    expect(commitMessage('Mac-A', ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'])).toBe('sync (Mac-A): a.md, b.md, c.md +2 more')
  })

  it('drops macOS’s `.local` suffix from the hostname', () => {
    expect(hostName('Yasins-MacBook-Pro.local')).toBe('Yasins-MacBook-Pro')
    expect(hostName('DESKTOP-42')).toBe('DESKTOP-42')
  })
})

describe('syncFolder', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('commits dirty files and pushes them, naming the host and the files in the subject', async () => {
    const { repo, remote } = await pushedRepo()
    await repo.write('a.md', '# a\n')
    await repo.write('sub/b.md', '# b\n')

    const res = await pass(repo)

    expect(res).toMatchObject({ attention: null, offline: false, fetched: true, level: true, tooBig: [] })
    expect(res.facts).toMatchObject({ branch: 'main', remoteUrl: remote.url, pending: [], conflicts: [] })
    expect(await repo.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): a.md, b.md')
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
  })

  it('makes no commit when nothing changed, and still ends level', async () => {
    const { repo } = await pushedRepo()
    const head = await repo.run(['rev-parse', 'HEAD'])
    expect(await pass(repo)).toMatchObject({ attention: null, level: true })
    expect(await repo.run(['rev-parse', 'HEAD'])).toBe(head)
  })

  it('gives fetch and push the transfer budget and every local call the default', async () => {
    const { repo } = await pushedRepo()
    await repo.write('a.md', '# a\n')
    vi.mocked(git).mockClear()

    await pass(repo)

    const calls = vi.mocked(git).mock.calls.filter(([, root]) => root === repo.root)
    const timeoutOf = (verb: string) => calls.filter(([, , args]) => args[0] === verb).map(([, , , opts]) => opts?.timeoutMs)
    expect(timeoutOf('fetch')).toEqual([TRANSFER_TIMEOUT_MS])
    expect(timeoutOf('push')).toEqual([TRANSFER_TIMEOUT_MS])
    expect(calls.filter(([, , args]) => args[0] !== 'fetch' && args[0] !== 'push').every(([, , , opts]) => opts?.timeoutMs === undefined)).toBe(true)
  })

  it('rebases a behind-only repo, pushes nothing, and says it was receiving', async () => {
    const { repo, remote } = await pushedRepo()
    await pushFrom(await otherComputer(remote), { 'note.md': 'from B\n' })
    const tip = await remoteHead(repo, remote)
    const directions: string[] = []

    expect(await pass(repo, { onDirection: (d) => directions.push(d) })).toMatchObject({ attention: null, level: true })

    expect(await repo.run(['rev-parse', 'HEAD'])).toBe(tip)
    expect(await repo.read('note.md')).toBe('from B\n')
    expect(directions).toEqual(['down'])
  })

  it('replays a diverged-but-clean pair: both files survive, history stays one line', async () => {
    const { repo, remote } = await pushedRepo()
    await pushFrom(await otherComputer(remote), { 'other.md': '# from B\n' })
    await repo.write('note.md', 'edited here\n')
    const directions: string[] = []

    expect(await pass(repo, { onDirection: (d) => directions.push(d) })).toMatchObject({ attention: null, level: true })

    expect(await repo.run(['log', '--format=%s'])).toBe('sync (Mac-A): note.md\nsync (Mac-B)\nbase')
    expect(await repo.run(['rev-list', '--merges', 'HEAD'])).toBe('')
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
    expect(directions).toEqual(['down', 'up'])
  })

  it('sets the upstream on a first push', async () => {
    const repo = await makeGitRepo()
    const remote = await makeBareRemote()
    cleanups.push(repo.cleanup, remote.cleanup)
    await repo.write('a.md', 'a\n')
    await wireOrigin(repo, remote)

    expect(await pass(repo)).toMatchObject({ attention: null, level: true })
    expect(await repo.run(['rev-parse', '--abbrev-ref', '@{u}'])).toBe('origin/main')
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
  })

  it('treats an empty clone of an empty GitHub repo as level, not as a failed push', async () => {
    const repo = await makeGitRepo()
    const remote = await makeBareRemote()
    cleanups.push(repo.cleanup, remote.cleanup)
    await wireOrigin(repo, remote)
    expect(await pass(repo)).toMatchObject({ attention: null, offline: false, level: true })
  })

  it('runs the exchange again when another computer’s push lands between our fetch and our push', async () => {
    const { repo, remote } = await pushedRepo()
    const b = await otherComputer(remote)
    await b.write('b.md', 'b\n')
    await b.run(['add', '-A'])
    await b.run(['commit', '-qm', 'sync (Mac-B): b.md'])
    // The race, made deterministic: the first time A pushes, B's push lands first.
    const hook = path.join(repo.root, '.git', 'hooks', 'pre-push')
    const done = `${shPath(hook)}.done`
    await writeFile(hook, `#!/bin/sh\n[ -f "${done}" ] && exit 0\ntouch "${done}"\ngit -C "${shPath(b.root)}" push -q\n`, { mode: 0o755 })
    await repo.write('a.md', 'a\n')

    expect(await pass(repo)).toMatchObject({ attention: null, level: true })
    expect(await repo.run(['log', '--format=%s'])).toBe('sync (Mac-A): a.md\nsync (Mac-B): b.md\nbase')
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
  })

  it('reports a folder without origin as an error, in git’s words', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    expect((await pass(repo)).attention).toEqual({ kind: 'error', detail: "error: No such remote 'origin'" })
  })

  it('reports a folder that is no longer a repo as an error without reading anything', async () => {
    const res = await syncFolder(path.join(tmpdir(), 'autosync-gone-folder'), { host: 'Mac-A' })
    expect(res).toMatchObject({ attention: { kind: 'error' }, facts: null })
  })

  it('reports no git as attention/no-git instead of throwing', async () => {
    const { repo } = await pushedRepo()
    expect(await pass(repo, { candidates: [] })).toMatchObject({ attention: { kind: 'no-git' }, facts: null })
  })

  it('commits locally and reports offline when the remote is unreachable', async () => {
    const { repo } = await pushedRepo()
    await repo.run(['remote', 'set-url', 'origin', path.join(tmpdir(), 'autosync-no-such-remote')])
    await repo.write('offline.md', '# on a train\n')

    const res = await pass(repo)

    expect(res).toMatchObject({ attention: null, offline: true, fetched: false, level: false })
    expect(await repo.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): offline.md')
    // Committed but not on GitHub: still pending.
    expect(res.facts?.pending).toEqual([{ status: 'A', path: 'offline.md' }])
  })

  it('reports a computer without a git identity as attention/no-identity', async () => {
    const { repo } = await pushedRepo()
    await repo.run(['config', '--unset', 'user.name'])
    await repo.run(['config', '--unset', 'user.email'])
    await repo.run(['config', 'user.useConfigOnly', 'true'])
    await repo.write('a.md', 'a\n')
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    try {
      expect((await pass(repo)).attention).toEqual({ kind: 'no-identity' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('busy repo (D16): zero writes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** Every verb a pass could write with. A busy repo must see none of them. */
  const WRITES = new Set(['add', 'commit', 'fetch', 'rebase', 'push', 'stash', 'reset', 'checkout', 'rm', 'update-ref'])

  async function assertUntouched(repo: GitRepo, detail: string): Promise<void> {
    const head = await git(bin, repo.root, ['rev-parse', 'HEAD'])
    await repo.write('dirty.md', 'user is mid-something\n')
    vi.mocked(git).mockClear()

    const res = await pass(repo)

    expect(res.attention).toEqual({ kind: 'busy-repo', detail })
    const verbs = vi.mocked(git).mock.calls.filter(([, root]) => root === repo.root).map(([, , args]) => args[0] ?? '')
    expect(verbs.filter((v) => WRITES.has(v))).toEqual([])
    expect((await git(bin, repo.root, ['rev-parse', 'HEAD'])).stdout).toBe(head.stdout)
  }

  async function divergedRepo(): Promise<GitRepo> {
    const { repo } = await pushedRepo()
    await repo.run(['checkout', '-q', '-b', 'side'])
    await repo.write('note.md', 'side\n')
    await repo.run(['commit', '-qam', 'side'])
    await repo.run(['checkout', '-q', 'main'])
    await repo.write('note.md', 'main\n')
    await repo.run(['commit', '-qam', 'main'])
    return repo
  }

  it('mid-rebase', async () => {
    const repo = await divergedRepo()
    expect((await git(bin, repo.root, ['rebase', 'side'])).code).not.toBe(0)
    await assertUntouched(repo, 'rebase')
  })

  it('mid-merge', async () => {
    const repo = await divergedRepo()
    expect((await git(bin, repo.root, ['merge', 'side'])).code).not.toBe(0)
    await assertUntouched(repo, 'merge')
  })

  it('detached HEAD', async () => {
    const { repo } = await pushedRepo()
    await repo.run(['checkout', '-q', '--detach', 'HEAD'])
    await assertUntouched(repo, 'detached')
  })
})

describe('keep-both conflicts (D6)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const COPY = /^note \(conflict Mac-A, \d{4}-\d{2}-\d{2}\)\.md$/

  it('keeps GitHub’s version at the path and ours beside it, finishes the rebase, and derives the attention', async () => {
    const { repo, remote } = await pushedRepo()
    const b = await otherComputer(remote)
    await pushFrom(b, { 'note.md': 'from B\n' })
    await repo.write('note.md', 'from A\n')

    const res = await pass(repo)

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(COPY)
    expect(res.attention).toEqual({ kind: 'conflict', conflicts: [{ original: 'note.md', copy }] })
    expect(res.level).toBe(true)
    expect(await repo.read('note.md')).toBe('from B\n')
    expect(await repo.read(copy)).toBe('from A\n')
    expect(await repo.run(['rev-list', '--merges', 'HEAD'])).toBe('')
    expect(existsSync(path.join(repo.root, '.git', 'rebase-merge'))).toBe(false)
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
    // No git temp file left behind in the folder.
    expect(await repo.run(['status', '--porcelain'])).toBe('')

    // The other computer receives both.
    await b.run(['pull', '-q', '--rebase'])
    expect(await b.read('note.md')).toBe('from B\n')
    expect(await b.read(copy)).toBe('from A\n')
  })

  it('settles every conflicted file in one pass, nested ones included', async () => {
    const { repo, remote } = await pushedRepo()
    await repo.write('docs/two.md', 'base\n')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'two'])
    await repo.run(['push', '-q'])
    await pushFrom(await otherComputer(remote), { 'note.md': 'B1\n', 'docs/two.md': 'B2\n' })
    await repo.write('note.md', 'A1\n')
    await repo.write('docs/two.md', 'A2\n')

    const res = await pass(repo)

    expect(res.facts?.conflicts.map((c) => c.original).sort()).toEqual(['docs/two.md', 'note.md'])
    for (const { original, copy } of res.facts?.conflicts ?? []) {
      expect(await repo.read(original)).toBe(original === 'note.md' ? 'B1\n' : 'B2\n')
      expect(await repo.read(copy)).toBe(original === 'note.md' ? 'A1\n' : 'A2\n')
    }
  })

  it('numbers the copy when today’s name is taken', async () => {
    const { repo, remote } = await pushedRepo()
    const b = await otherComputer(remote)
    await pushFrom(b, { 'note.md': 'B1\n' })
    await repo.write('note.md', 'A1\n')
    const first = (await pass(repo)).facts?.conflicts[0]?.copy ?? ''

    await b.run(['pull', '-q', '--rebase'])
    await pushFrom(b, { 'note.md': 'B2\n' })
    await repo.write('note.md', 'A2\n')
    const res = await pass(repo)

    const second = res.facts?.conflicts.map((c) => c.copy).find((c) => c !== first) ?? ''
    expect(second).toBe(first.replace(/\)\.md$/, ' 2).md'))
    expect(await repo.read(first)).toBe('A1\n')
    expect(await repo.read(second)).toBe('A2\n')
  })

  it('is binary-safe: every byte of both versions survives', async () => {
    const { repo, remote } = await pushedRepo()
    const theirs = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 256))
    const ours = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 13 + 1) % 256))
    await repo.write('pic.bin', Buffer.from([0, 1, 2, 0xff]))
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'pic'])
    await repo.run(['push', '-q'])
    await pushFrom(await otherComputer(remote), { 'pic.bin': theirs })
    await repo.write('pic.bin', ours)

    const res = await pass(repo)

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(/^pic \(conflict Mac-A, \d{4}-\d{2}-\d{2}\)\.bin$/)
    expect((await readFile(path.join(repo.root, 'pic.bin'))).equals(theirs)).toBe(true)
    expect((await readFile(path.join(repo.root, copy))).equals(ours)).toBe(true)
  })

  it('delete on one side, edit on the other: the edit stays at the path, no copy', async () => {
    const { repo, remote } = await pushedRepo()
    await pushFrom(await otherComputer(remote), { 'note.md': 'edited on B\n' })
    await unlink(path.join(repo.root, 'note.md'))

    const res = await pass(repo)

    expect(res).toMatchObject({ attention: null, level: true })
    expect(await repo.read('note.md')).toBe('edited on B\n')
    expect(res.facts?.conflicts).toEqual([])
  })

  it('the derived attention clears once the copy is deleted (on any computer)', async () => {
    const { repo, remote } = await pushedRepo()
    const b = await otherComputer(remote)
    await pushFrom(b, { 'note.md': 'from B\n' })
    await repo.write('note.md', 'from A\n')
    const copy = (await pass(repo)).facts?.conflicts[0]?.copy ?? ''

    await b.run(['pull', '-q', '--rebase'])
    await b.run(['rm', '-q', copy])
    await b.run(['commit', '-qm', 'sync (Mac-B)'])
    await b.run(['push', '-q'])

    const res = await pass(repo)
    expect(res.attention).toBeNull()
    expect(existsSync(path.join(repo.root, copy))).toBe(false)
  })
})

describe('files too big for GitHub (D11)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('holds an oversize file back and syncs everything else', async () => {
    const { repo, remote } = await pushedRepo()
    await repo.write('small.md', '# small\n')
    await oversize(repo, 'Folder/Huge video.mov')

    const res = await pass(repo)

    expect(res).toMatchObject({ attention: null, level: true, tooBig: [{ path: 'Folder/Huge video.mov', bytes: TOO_BIG_BYTES }] })
    const tracked = await repo.run(['ls-files'])
    expect(tracked).toContain('small.md')
    expect(tracked).not.toContain('Huge')
    expect(await repo.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): small.md')
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
    // Never even hashed: excluded BEFORE the add, so no 95 MB blob lands in .git/objects.
    expect(Number(/(\d+) kilobytes/.exec(await repo.run(['count-objects']))?.[1])).toBeLessThan(1024)
  })

  it('draws the line AT the limit, and a second pass is the same calm answer with no commit', async () => {
    const { repo } = await pushedRepo()
    await oversize(repo, 'under.mov', TOO_BIG_BYTES - 1)
    await oversize(repo, 'at.mov')

    expect((await pass(repo)).tooBig).toEqual([{ path: 'at.mov', bytes: TOO_BIG_BYTES }])
    expect(await repo.run(['ls-files'])).toContain('under.mov')
    const head = await repo.run(['rev-parse', 'HEAD'])
    expect((await pass(repo)).tooBig).toEqual([{ path: 'at.mov', bytes: TOO_BIG_BYTES }])
    expect(await repo.run(['rev-parse', 'HEAD'])).toBe(head)
  })

  /** A stash the user made by hand, before AutoSync ever ran: its sha. */
  async function userStash(repo: GitRepo): Promise<string> {
    await repo.write('note.md', 'my own work in progress\n')
    await repo.run(['stash', 'push', '-q', '-m', 'my wip'])
    return repo.run(['rev-parse', 'refs/stash'])
  }

  it('a held-back TRACKED file never blocks the rebase, its bytes stay exactly as they were, and the user\u2019s own stash is untouched', async () => {
    const { repo, remote } = await pushedRepo()
    await pushFrom(await otherComputer(remote), { 'note.md': 'line one\nfrom B\n', 'other.md': '# other\n' })
    const mine = await userStash(repo)
    const big = path.join(repo.root, 'note.md')
    await writeFile(big, 'our head\n')
    await truncate(big, TOO_BIG_BYTES + 1)
    const before = await sha1(big)
    await repo.write('small.md', '# small\n')

    const res = await pass(repo)

    expect(res).toMatchObject({ attention: null, level: true, tooBig: [{ path: 'note.md', bytes: TOO_BIG_BYTES + 1 }] })
    expect(await repo.run(['log', '--format=%s'])).toBe('sync (Mac-A): small.md\nsync (Mac-B)\nbase')
    expect(await sha1(big)).toBe(before)
    expect(await repo.run(['show', 'HEAD:note.md'])).toBe('line one\nfrom B')
    expect(await repo.run(['stash', 'list', '--format=%H'])).toBe(mine)
  })

  it('never drops the user\u2019s stash when the held-back file was reverted before the park (the park saves nothing)', async () => {
    const { repo, remote } = await pushedRepo()
    await pushFrom(await otherComputer(remote), { 'other.md': '# other\n' })
    const mine = await userStash(repo)
    await oversize(repo, 'note.md', TOO_BIG_BYTES + 1)
    const real = vi.mocked(git).getMockImplementation() as typeof git
    // The user undoes the big edit in the moment between the size check and the park.
    vi.mocked(git).mockImplementation(async (b, root, args, opts) => {
      if (args[0] === 'stash' && args[1] === 'push') await real(b, root, ['checkout', '--', 'note.md'])
      return real(b, root, args, opts)
    })
    try {
      expect(await pass(repo)).toMatchObject({ attention: null, level: true })
    } finally {
      vi.mocked(git).mockImplementation(real)
    }
    expect(await repo.run(['stash', 'list', '--format=%H'])).toBe(mine)
    expect(await repo.read('note.md')).toBe('line one\n')
    expect(await repo.run(['log', '--format=%s'])).toBe('sync (Mac-B)\nbase')
  })

  it('clears once the file is gone', async () => {
    const { repo } = await pushedRepo()
    await oversize(repo, 'Huge.mov')
    expect((await pass(repo)).tooBig).toHaveLength(1)
    await rm(path.join(repo.root, 'Huge.mov'))
    expect((await pass(repo)).tooBig).toEqual([])
  })
})

describe('flush mode (quit)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('commits and pushes with no fetch and a 5 s push cap', async () => {
    const { repo, remote } = await pushedRepo()
    await repo.write('note.md', 'line one\nline two\n')
    vi.mocked(git).mockClear()

    expect(await pass(repo, { flush: true })).toMatchObject({ attention: null, fetched: false, level: false })

    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
    const calls = vi.mocked(git).mock.calls.filter(([, root]) => root === repo.root)
    expect(calls.some(([, , args]) => args[0] === 'fetch')).toBe(false)
    expect(calls.filter(([, , args]) => args[0] === 'push').map(([, , , opts]) => opts?.timeoutMs)).toEqual([5_000])
  })
})
