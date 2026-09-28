import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { tempDir } from './git/gitFixture'
import { watchFolder } from './watch'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: condition never held')
    await new Promise((r) => setTimeout(r, 20))
  }
}

it('fires for a change anywhere in the folder but not inside .git or node_modules, and stops when closed', async () => {
  const root = await tempDir('watch')
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, '.git'))
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(root, 'notes'))
  let events = 0
  const close = watchFolder(root, () => {
    events += 1
  })
  cleanups.push(close)
  await new Promise((r) => setTimeout(r, 300)) // the initial scan

  await writeFile(path.join(root, '.git', 'index'), 'x')
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x')
  await new Promise((r) => setTimeout(r, 400))
  expect(events).toBe(0)

  await writeFile(path.join(root, 'notes', 'a.md'), 'x')
  await until(() => events > 0)

  close()
  const seen = events
  await writeFile(path.join(root, 'notes', 'b.md'), 'x')
  await new Promise((r) => setTimeout(r, 400))
  expect(events).toBe(seen)
})
