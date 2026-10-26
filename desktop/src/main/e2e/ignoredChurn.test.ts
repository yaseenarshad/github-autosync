import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PEEK_MS } from '@shared/status'
import { gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead } from '../git/gitFixture'
import { createSyncManager } from '../git/manager'
import { peekPending } from '../git/sync'
import { watchFolder } from '../watch'

/**
 * D33 through the real manager and the real watcher: a `.venv` and a SQLite side file that change
 * all the time never start a peek, and an edit to a tracked file still goes out after the quiet wait.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function until(cond: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('until: condition never held')
    await new Promise((r) => setTimeout(r, 50))
  }
}

it('what git ignores never wakes the folder; a tracked edit still syncs', { timeout: REAL_GIT_TIMEOUT_MS * 2 }, async () => {
  const { repo, remote, cleanup } = await pushedRepo({ '.gitignore': '.venv/\n*.db-wal\n', 'note.md': 'base\n' })
  cleanups.push(cleanup)
  for (let i = 0; i < 500; i += 1) await repo.write(`.venv/lib/pkg${i % 50}/m${i}.py`, 'x')
  let peeks = 0
  const manager = createSyncManager(
    gitHost('Mac-A', {
      watch: watchFolder,
      peek: (root) => {
        peeks += 1
        return peekPending(root)
      },
      peekMs: PEEK_MS, // the app's own settle: git's list is read again on the same clock
      quietMs: 300,
    }),
  )
  manager.setFolders([{ id: 'a', path: repo.root, enabled: true }], false)
  cleanups.push(async () => manager.setFolders([], false))
  await until(() => manager.folders()[0]?.state === 'synced')
  await new Promise((r) => setTimeout(r, 1_500)) // past the own-writes window (OWN_WRITES_MS)

  // The lab's database: its side file changes every 50 ms for 3 s, and a package lands in .venv.
  const writer = setInterval(() => void writeFile(path.join(repo.root, 'lab.db-wal'), String(Date.now())), 50)
  cleanups.push(async () => clearInterval(writer))
  for (let i = 0; i < 100; i += 1) await repo.write(`.venv/lib/new/m${i}.py`, 'x')
  await new Promise((r) => setTimeout(r, 3_000))
  clearInterval(writer)
  expect(peeks).toBeLessThanOrEqual(1) // the first lab.db-wal, before git's list caught up (D33)
  expect(manager.folders()[0]?.state).toBe('synced')

  const before = await remoteHead(repo, remote)
  await repo.write('note.md', 'edited\n')
  await until(async () => (await remoteHead(repo, remote)) !== before)
})
