import { truncate } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FolderStatus } from '@shared/types'
import { readActivity } from '../git/activity'
import { clone, gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead, type GitRepo } from '../git/gitFixture'
import { createSyncManager, type SyncManager } from '../git/manager'

/**
 * 5A: two computers, one GitHub. Each computer runs the real manager over the real sync pass
 * against a bare repo on disk; the test plays the user (edits files) and the clock (`syncNow`
 * stands in for the debounce firing — the cadence itself is pinned in manager.test.ts).
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

interface Computer {
  repo: GitRepo
  manager: SyncManager
  status: () => FolderStatus
  sync: () => Promise<FolderStatus>
}

function computer(repo: GitRepo, host: string): Computer {
  const manager = createSyncManager(gitHost(host))
  manager.setFolders([{ id: host, path: repo.root, enabled: true }], false)
  const status = () => manager.folders()[0] as FolderStatus
  return {
    repo,
    manager,
    status,
    sync: async () => {
      await manager.syncNow(host)
      return status()
    },
  }
}

async function twoComputers(): Promise<{ a: Computer; b: Computer; head: () => Promise<string> }> {
  const { repo, remote, cleanup } = await pushedRepo({ 'note.md': 'base\n' })
  cleanups.push(cleanup)
  const bRepo = await clone(remote, 'Sam')
  cleanups.push(bRepo.cleanup)
  const a = computer(repo, 'Mac-A')
  const b = computer(bRepo, 'Mac-B')
  // Both start with a pass (D3); let those land before the scenario begins.
  await a.manager.syncNow(null)
  await b.manager.syncNow(null)
  cleanups.push(async () => {
    a.manager.setFolders([], false)
    b.manager.setFolders([], false)
  })
  return { a, b, head: () => remoteHead(repo, remote) }
}

describe('5A: two clones through the real manager', { timeout: REAL_GIT_TIMEOUT_MS * 2 }, () => {
  it('an edit on A reaches B, and an edit on B reaches A', async () => {
    const { a, b, head } = await twoComputers()

    await a.repo.write('from-a.md', 'written on A\n')
    expect(await a.sync()).toMatchObject({ state: 'synced', pending: [], lastSyncedAt: expect.any(Number) })
    expect(await b.sync()).toMatchObject({ state: 'synced' })
    expect(await b.repo.read('from-a.md')).toBe('written on A\n')

    await b.repo.write('note.md', 'edited on B\n')
    await b.sync()
    await a.sync()
    expect(await a.repo.read('note.md')).toBe('edited on B\n')
    expect(await head()).toBe(await a.repo.run(['rev-parse', 'HEAD']))
    expect(await a.repo.run(['log', '--format=%s'])).toBe('sync (Mac-B): note.md\nsync (Mac-A): from-a.md\nbase')
  })

  it('the same file changed on both keeps both, on both computers, and says so on both', async () => {
    const { a, b } = await twoComputers()
    await a.repo.write('note.md', 'A’s version\n')
    await b.repo.write('note.md', 'B’s version\n')

    await b.sync() // B wins the race to GitHub
    const onA = await a.sync()
    const onB = await b.sync()

    const copy = onA.attention?.conflicts?.[0]?.copy ?? ''
    expect(copy).toMatch(/^note \(conflict Mac-A, \d{4}-\d{2}-\d{2}\)\.md$/)
    for (const [side, status] of [[a, onA], [b, onB]] as const) {
      expect(status).toMatchObject({ state: 'attention', attention: { kind: 'conflict', conflicts: [{ original: 'note.md', copy }] } })
      expect(await side.repo.read('note.md')).toBe('B’s version\n')
      expect(await side.repo.read(copy)).toBe('A’s version\n')
      expect(await side.repo.run(['rev-list', '--merges', 'HEAD'])).toBe('')
    }

    // Deleting the copy on either computer clears it on both.
    await b.repo.run(['rm', '-q', copy])
    expect((await b.sync()).attention).toBeNull()
    expect((await a.sync()).attention).toBeNull()
  })

  it('a 150 MB file on A is held back as too big while everything else syncs', async () => {
    const { a, b } = await twoComputers()
    await a.repo.write('video.mov', '')
    await truncate(path.join(a.repo.root, 'video.mov'), 150 * 1024 * 1024)
    await a.repo.write('notes.md', 'small\n')

    expect(await a.sync()).toMatchObject({ state: 'synced', pending: [], tooBig: [{ path: 'video.mov', bytes: 150 * 1024 * 1024 }] })
    await b.sync()
    expect(await b.repo.read('notes.md')).toBe('small\n')
    expect(await b.repo.run(['ls-files'])).not.toContain('video.mov')
  })

  it('A’s activity shows what it sent, what it received and the conflict', async () => {
    const { a, b } = await twoComputers()
    await a.repo.write('a.md', 'a\n')
    await a.sync()
    await b.sync()
    await b.repo.write('b.md', 'b\n')
    await b.sync()
    await a.sync()
    await a.repo.write('note.md', 'A\n')
    await b.repo.write('note.md', 'B\n')
    await b.sync()
    await a.sync()

    const page = await readActivity(a.repo.root, 'Mac-A')

    expect(page.entries.map((e) => [e.kind, e.host, e.subject])).toEqual([
      ['conflict', 'Mac-A', 'sync (Mac-A): note.md'],
      ['received', 'Mac-B', 'sync (Mac-B): note.md'],
      ['received', 'Mac-B', 'sync (Mac-B): b.md'],
      ['sent', 'Mac-A', 'sync (Mac-A): a.md'],
      ['manual', 'AutoSync Test', 'base'],
    ])
  })
})
