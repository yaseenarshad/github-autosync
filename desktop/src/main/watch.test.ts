import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PEEK_MS } from '@shared/status'
import { makeGitRepo, tempDir } from './git/gitFixture'
import { watchFolder } from './watch'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: condition never held')
    await sleep(20)
  }
}

/** Watches `root` and counts its events, from 0 once the watch has settled. */
async function countEvents(root: string): Promise<{ readonly n: number; close: () => void }> {
  let n = 0
  const close = watchFolder(root, () => {
    n += 1
  })
  cleanups.push(close)
  await sleep(500)
  n = 0 // FSEvents can still hand over the setup writes made just before the watch started
  return {
    get n() {
      return n
    },
    close,
  }
}

it('fires for a change anywhere in the folder but not inside .git or node_modules, and stops when closed', async () => {
  const root = await tempDir('watch')
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.git'))
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(root, 'notes'))
  const events = await countEvents(root)

  await writeFile(path.join(root, '.git', 'index'), 'x')
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x')
  await sleep(400)
  expect(events.n).toBe(0)

  await writeFile(path.join(root, 'notes', 'a.md'), 'x')
  await until(() => events.n > 0)

  events.close()
  const seen = events.n
  await writeFile(path.join(root, 'notes', 'b.md'), 'x')
  await sleep(400)
  expect(events.n).toBe(seen)
})

it('skips what git ignores, picks up a new ignored folder, and follows a .gitignore edit', { timeout: 15_000 }, async () => {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('.gitignore', '.venv/\n*.db-wal\nbuild/\n')
  await repo.write('.venv/lib/site.py', 'x')
  await repo.write('data/lab.db-wal', 'x')
  await repo.write('notes/a.md', 'x')
  const events = await countEvents(repo.root)

  await repo.write('.venv/lib/site.py', 'y')
  await repo.write('data/lab.db-wal', 'y')
  await sleep(400)
  expect(events.n).toBe(0)

  await repo.write('notes/a.md', 'y')
  await until(() => events.n > 0)

  // Made after the start: it may wake the folder once, then git's list catches up.
  await repo.write('build/out.js', 'x')
  await sleep(PEEK_MS + 500)
  let seen = events.n
  await repo.write('build/out.js', 'y')
  await sleep(400)
  expect(events.n).toBe(seen)

  // A .gitignore edit replaces the list: notes/ goes quiet.
  await repo.write('.gitignore', '.venv/\n*.db-wal\nbuild/\nnotes/\n')
  await sleep(PEEK_MS + 500)
  seen = events.n
  await repo.write('notes/a.md', 'z')
  await sleep(400)
  expect(events.n).toBe(seen)

  // And back: build/ is no longer ignored, so it is watched again.
  await repo.write('.gitignore', '.venv/\n*.db-wal\nnotes/\n')
  await sleep(PEEK_MS + 500)
  seen = events.n
  await repo.write('build/out.js', 'z')
  await until(() => events.n > seen)
})

it('a folder that holds only ignored files (a Finder .DS_Store) still wakes for a real file saved in it', { timeout: 10_000 }, async () => {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('.gitignore', '.DS_Store\n')
  await repo.write('notes/.DS_Store', 'x') // at start
  const events = await countEvents(repo.root)
  await repo.write('notes/todo.md', 'x')
  await until(() => events.n > 0)

  // A folder made after the start: Finder writes its .DS_Store first, then git's list is read.
  await repo.write('drafts/.DS_Store', 'x')
  await sleep(PEEK_MS + 500)
  const seen = events.n
  await repo.write('drafts/post.md', 'x')
  await until(() => events.n > seen)
})

it('a failed read after a .gitignore edit tries again on the next event (S12)', { timeout: 15_000 }, async () => {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('.gitignore', '\n')
  await repo.write('notes/a.md', 'x')
  await repo.write('cache/c.bin', 'x')
  const events = await countEvents(repo.root)
  // git cannot read the repo for a moment, so the read after the edit fails
  await rename(path.join(repo.root, '.git', 'HEAD'), path.join(repo.root, '.git', 'HEAD.off'))
  await repo.write('.gitignore', 'cache/\n')
  await sleep(PEEK_MS + 500)
  await rename(path.join(repo.root, '.git', 'HEAD.off'), path.join(repo.root, '.git', 'HEAD'))
  await repo.write('notes/a.md', 'y') // the next event: an edit to a tracked file
  await sleep(PEEK_MS + 500)
  const seen = events.n
  await repo.write('cache/c.bin', 'y')
  await sleep(400)
  expect(events.n).toBe(seen) // cache/ is ignored now
})

it('a force-added file wakes the folder again, and .git/info/exclude applies at once (S8, S11)', { timeout: 15_000 }, async () => {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('.gitignore', '*.cfg\n')
  await repo.write('app.cfg', 'x')
  await repo.write('scratch/s.txt', 'x')
  const events = await countEvents(repo.root)
  await repo.write('app.cfg', 'y')
  await sleep(400)
  expect(events.n).toBe(0)

  await repo.run(['add', '-f', 'app.cfg']) // tracked now: git no longer lists it
  await sleep(PEEK_MS + 500)
  let seen = events.n
  await repo.write('app.cfg', 'z')
  await until(() => events.n > seen)

  await repo.write('.git/info/exclude', 'scratch/\n')
  await sleep(PEEK_MS + 500)
  seen = events.n
  await repo.write('scratch/s.txt', 'y')
  await sleep(400)
  expect(events.n).toBe(seen)
})

it('in a linked worktree, a force-added file wakes the folder again (S8: the index is outside the folder)', { timeout: 15_000 }, async () => {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  await repo.write('.gitignore', '*.cfg\n')
  await repo.write('note.md', 'x')
  await repo.run(['add', '-A'])
  await repo.run(['commit', '-m', 'base'])
  const wt = `${repo.root}-wt`
  await repo.run(['worktree', 'add', '-b', 'wt', wt])
  cleanups.push(() => rm(wt, { recursive: true, force: true }))
  await writeFile(path.join(wt, 'app.cfg'), 'x')
  const events = await countEvents(wt)
  await sleep(PEEK_MS + 500) // a setup event may still read the list again: let it settle

  await repo.run(['-C', wt, 'add', '-f', 'app.cfg']) // tracked now: git no longer lists it
  await sleep(PEEK_MS + 500)
  const seen = events.n
  await writeFile(path.join(wt, 'app.cfg'), 'z')
  await until(() => events.n > seen)
})
