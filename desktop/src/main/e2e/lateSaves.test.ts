import { existsSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FolderStatus } from '@shared/types'
import { clone, fakeGitHub, gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead, snapshot, type GitRepo } from '../git/gitFixture'
import { createSyncManager, type SyncHost, type SyncManager } from '../git/manager'
import { IN_FLIGHT } from '../git/pullRequest'
import { syncFolder } from '../git/sync'

/**
 * D30/D31 through the real manager: a tracked file some program keeps rewriting (a tool's cache)
 * must never put the folder in attention, on either route. Real git against a bare repo on disk;
 * `syncNow` stands in for the clock, as in twoClones.test.ts.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

interface Computer {
  repo: GitRepo
  manager: SyncManager
  /** Every status the UI was handed, in order. */
  seen: FolderStatus[]
  sync: () => Promise<FolderStatus>
}

function computer(repo: GitRepo, host: string, over: Partial<SyncHost> = {}): Computer {
  const seen: FolderStatus[] = []
  const status = () => manager.folders()[0] as FolderStatus
  const manager = createSyncManager(gitHost(host, { ...over, onChange: () => seen.push(status()) }))
  manager.setFolders([{ id: host, path: repo.root, enabled: true }], false)
  cleanups.push(async () => manager.setFolders([], false))
  return {
    repo,
    manager,
    seen,
    sync: async () => {
      await manager.syncNow(host)
      return status()
    },
  }
}

const FILES = { 'note.md': 'base\n', 'cache.json': '0\n' }

describe('late saves through the real manager (D30, D31)', { timeout: REAL_GIT_TIMEOUT_MS * 3 }, () => {
  it('push route: a file rewritten the whole time never asks for attention, and both computers end the same', async () => {
    const { repo, remote, cleanup } = await pushedRepo(FILES)
    const bRepo = await clone(remote, 'Sam')
    cleanups.push(cleanup, bRepo.cleanup)
    const a = computer(repo, 'Mac-A')
    const b = computer(bRepo, 'Mac-B')
    await a.sync()
    await b.sync()

    // The program: rewrites A's tracked file every 20 ms, on its own clock.
    let n = 0
    let written: Promise<void> = Promise.resolve()
    const writer = setInterval(() => {
      n += 1
      written = written.then(() => writeFile(path.join(repo.root, 'cache.json'), `${n}\n`))
    }, 20)
    try {
      for (let round = 1; round <= 4; round += 1) {
        await b.repo.write(`from-b-${round}.md`, `${round}\n`)
        await b.sync() // A is behind again: its next pass must rebase under the writer
        await a.sync()
      }
    } finally {
      clearInterval(writer)
      await written
    }
    await a.sync()
    await b.sync()

    expect(a.seen.flatMap((s) => (s.attention ? [s.attention] : []))).toEqual([])
    expect(b.seen.flatMap((s) => (s.attention ? [s.attention] : []))).toEqual([])
    expect(await a.sync()).toMatchObject({ state: 'synced', pending: [] })
    expect(await repo.read('cache.json')).toBe(`${n}\n`)
    expect(await snapshot(repo.root)).toEqual(await snapshot(bRepo.root))
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
    expect(await repo.run(['rev-list', '--merges', 'HEAD'])).toBe('')
    expect(await repo.run(['stash', 'list'])).toBe('')
    expect(existsSync(path.join(repo.root, '.git', 'rebase-merge'))).toBe(false)
  })

  it('PR route: a merged batch lands although the file was rewritten after the commit, and the save goes out in the next PR', async () => {
    const { repo, remote, cleanup } = await pushedRepo(FILES)
    cleanups.push(cleanup)
    const gh = await fakeGitHub(remote)
    const cache = path.join(repo.root, 'cache.json')
    let rewrite = false
    const a = computer(repo, 'Mac-A', {
      sync: (root, opts) =>
        syncFolder(root, {
          ...opts,
          host: 'Mac-A',
          github: gh,
          onDirection: (d) => {
            opts.onDirection?.(d)
            // The gap the program writes into: after the pass's commit, right before its rebase.
            if (rewrite && d === 'down') writeFileSync(cache, 'late\n')
          },
        }),
    })
    // A batch is out as PR 1, two more saves are committed behind it, and the repo's Action merges the PR.
    for (const content of ['1\n', '2\n', '3\n']) {
      await repo.write('cache.json', content)
      await a.sync()
    }
    expect(await gh.merge(1)).toBe(true)
    rewrite = true

    const landed = await a.sync()

    expect(a.seen.flatMap((s) => (s.attention ? [s.attention] : []))).toEqual([])
    expect(landed).toMatchObject({ state: 'pending', attention: null, pr: { number: 2 } })
    expect(await repo.read('cache.json')).toBe('late\n')
    expect(await repo.run(['status', '--porcelain'])).toBe('')
    expect(await repo.run(['log', '--format=%s'])).toBe(`${'sync (Mac-A): cache.json\n'.repeat(3)}sync (Mac-A): cache.json (#1)\nbase`)
    expect(await repo.run(['for-each-ref', '--format=%(objectname)', IN_FLIGHT])).toBe(await repo.run(['rev-parse', 'HEAD']))

    rewrite = false
    expect(await gh.merge(2)).toBe(true)
    expect(await a.sync()).toMatchObject({ state: 'synced', pr: null })
    expect(await remoteHead(repo, remote)).toBe(await repo.run(['rev-parse', 'HEAD']))
  })
})
