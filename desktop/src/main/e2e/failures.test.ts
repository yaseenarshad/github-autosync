import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderStatus } from '@shared/types'
import { git } from '../git/exec'
import { gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead, requireGit, type BareRemote, type GitRepo } from '../git/gitFixture'
import { createSyncManager, type SyncHost, type SyncManager } from '../git/manager'

// Real git; the spy counts invocations and, in one case, plays GitHub refusing a sign-in (no network).
vi.mock('../git/exec', async (actual) => {
  const mod = await actual<typeof import('../git/exec')>()
  return { ...mod, git: vi.fn(mod.git) }
})

/**
 * 5B: how the app behaves when things go wrong, through the real manager and real git. No git, quit
 * and paused are proven in guarantees.test.ts.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.mocked(git).mockClear()
  for (const c of cleanups.splice(0)) await c()
})

async function repo(): Promise<{ repo: GitRepo; remote: BareRemote }> {
  const fixture = await pushedRepo()
  cleanups.push(fixture.cleanup)
  return fixture
}

/** The real manager over one folder; resolves once the start pass has settled. */
async function start(root: string, over: Partial<SyncHost> = {}): Promise<{ manager: SyncManager; status: () => FolderStatus }> {
  const manager = createSyncManager(gitHost('Mac-A', over))
  cleanups.push(async () => manager.setFolders([], false))
  manager.setFolders([{ id: 'a', path: root, enabled: true }], false)
  await manager.syncNow('a')
  return { manager, status: () => manager.folders()[0] as FolderStatus }
}

const callsIn = (root: string) => vi.mocked(git).mock.calls.filter(([, cwd]) => cwd === root)

describe('5B: failure proofs', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('an unreachable remote: the change is committed, the folder waits offline, and one retry is armed', async () => {
    const { repo: r } = await repo()
    await r.run(['remote', 'set-url', 'origin', path.join(tmpdir(), 'autosync-no-such-remote')])
    await r.write('train.md', 'written offline\n')

    const { status } = await start(r.root)

    expect(status()).toMatchObject({ state: 'pending', offline: true, attention: null, retryAt: expect.any(Number), pending: [{ status: 'A', path: 'train.md' }] })
    expect(await r.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): train.md')
  })

  it('GitHub refusing the sign-in: attention/auth with git’s words, no retry, no poll', async () => {
    const { repo: r } = await repo()
    const real = vi.mocked(git).getMockImplementation() as typeof git
    vi.mocked(git).mockImplementation(async (bin, root, args, opts) =>
      args[0] === 'fetch' ? { code: 128, stdout: '', stderr: "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/me/notes.git/'" } : real(bin, root, args, opts),
    )
    try {
      const { status } = await start(r.root, { pollMs: 10, retryMs: 10 })
      expect(status()).toMatchObject({ state: 'attention', attention: { kind: 'auth', detail: "fatal: Authentication failed for 'https://github.com/me/notes.git/'" }, retryAt: null })
      const fetches = callsIn(r.root).filter(([, , args]) => args[0] === 'fetch').length
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(callsIn(r.root).filter(([, , args]) => args[0] === 'fetch')).toHaveLength(fetches)
    } finally {
      vi.mocked(git).mockImplementation(real)
    }
  })

  it('a rebase in progress: attention/busy-repo and not one commit', async () => {
    const { repo: r } = await repo()
    await r.run(['checkout', '-q', '-b', 'side'])
    await r.write('note.md', 'side\n')
    await r.run(['commit', '-qam', 'side'])
    await r.run(['checkout', '-q', 'main'])
    await r.write('note.md', 'main\n')
    await r.run(['commit', '-qam', 'main'])
    expect((await git(await requireGit(), r.root, ['rebase', 'side'])).code).not.toBe(0)
    await r.write('new.md', 'user is mid-rebase\n')
    const head = await r.run(['rev-parse', 'HEAD'])
    vi.mocked(git).mockClear()

    const { status } = await start(r.root)

    expect(status()).toMatchObject({ state: 'attention', attention: { kind: 'busy-repo', detail: 'rebase' } })
    expect(callsIn(r.root).filter(([, , args]) => ['add', 'commit', 'rebase', 'push', 'fetch'].includes(args[0] ?? ''))).toEqual([])
    expect(await r.run(['rev-parse', 'HEAD'])).toBe(head)
  })

  it('Docs syncing the same folder: warned about, and still synced', async () => {
    const { repo: r, remote } = await repo()
    await r.write('.yaseendocs/github.json', '{"enabled":true}')
    await r.write('doc.md', 'hello\n')

    const { status } = await start(r.root)

    expect(status()).toMatchObject({ state: 'synced', alsoSyncedBy: 'Docs' })
    expect(await remoteHead(r, remote)).toBe(await r.run(['rev-parse', 'HEAD']))
  })
})
