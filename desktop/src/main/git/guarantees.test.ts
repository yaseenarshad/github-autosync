// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/guarantees.test.ts; changes: AutoSync manager/host, keep-both with the host in the name, paused as well as disabled, real watcher for the silence guarantee.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderStatus } from '@shared/types'
import { git } from './exec'
import { clone, gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead, snapshot, type BareRemote, type GitRepo } from './gitFixture'
import { createSyncManager, type FolderConfig } from './manager'
import { syncFolder } from './sync'
import { watchFolder } from '../watch'

// Real git; the spy counts every invocation for the silence guarantee.
vi.mock('./exec', async (actual) => {
  const mod = await actual<typeof import('./exec')>()
  return { ...mod, git: vi.fn(mod.git) }
})

/**
 * The guarantees AutoSync stands on:
 *   1. a conflict is LOSSLESS — both computers' bytes survive (kept both), and a pass that has to
 *      stop anyway leaves the working tree as it was, a save made while it was stopped included
 *   2. passes on one folder never interleave, and a trigger burst coalesces to ONE follow-up
 *      (pinned on a fake host in manager.test.ts: the serialisation is the manager's, not git's)
 *   3. a disabled folder, or any folder while paused, produces ZERO git activity
 *   4. a computer with no git classifies `no-git` instead of throwing
 *   5. quit flush lands pending changes on the remote before it resolves
 */

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: condition never held')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function twoComputers(): Promise<{ a: GitRepo; b: GitRepo; remote: BareRemote }> {
  const { repo: a, remote, cleanup } = await pushedRepo({ 'note.md': 'line one\nline two\n' })
  cleanups.push(cleanup)
  const b = await clone(remote, 'Sam')
  cleanups.push(b.cleanup)
  return { a, b, remote }
}

async function pushFromB(b: GitRepo, content: string): Promise<void> {
  await b.write('note.md', content)
  await b.run(['commit', '-qam', 'sync (Mac-B): note.md'])
  await b.run(['push', '-q'])
}

describe('guarantee 1: a conflict is lossless', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('keeps both versions of a file both computers changed, and finishes the pass', async () => {
    const { a, b } = await twoComputers()
    await pushFromB(b, 'line one CHANGED ON B\nline two\n')
    await a.write('note.md', 'line one CHANGED ON A\nline two\n')

    const res = await syncFolder(a.root, { host: 'Mac-A' })

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(/^note \(conflict Mac-A, \d{4}-\d{2}-\d{2}\)\.md$/)
    const files = await snapshot(a.root)
    expect(files.get('note.md')?.toString()).toBe('line one CHANGED ON B\nline two\n')
    expect(files.get(copy)?.toString()).toBe('line one CHANGED ON A\nline two\n')
    expect(await a.run(['status'])).not.toMatch(/rebase in progress/i)
  })

  it('aborts back to the working tree it started from when the rebase cannot finish, keeping a save made mid-rebase', async () => {
    const { a, b } = await twoComputers()
    await pushFromB(b, 'line one CHANGED ON B\nline two\n')
    await a.write('note.md', 'line one CHANGED ON A\nline two\n')
    await a.write('other.md', 'saved before\n')
    await a.run(['add', '-A'])
    await a.run(['commit', '-qm', 'local work'])
    // A user hook that refuses any commit made while a rebase is stopped — and, standing in for the
    // user's editor, saves a file exactly then. The rebase cannot continue, so the pass aborts.
    const hook = path.join(a.root, '.git', 'hooks', 'prepare-commit-msg')
    await writeFile(hook, `#!/bin/sh\nif [ -d "$(git rev-parse --git-dir)/rebase-merge" ]; then echo "saved mid-rebase" > other.md; exit 1; fi\n`, { mode: 0o755 })
    const before = await snapshot(a.root)

    const res = await syncFolder(a.root, { host: 'Mac-A' })

    expect(res.attention).toMatchObject({ kind: 'error', detail: expect.stringMatching(/could not apply/) })
    expect(await snapshot(a.root)).toEqual(new Map([...before, ['other.md', Buffer.from('saved mid-rebase\n')]]))
    expect(await a.run(['status'])).not.toMatch(/rebase in progress/i)
  })
})

describe('guarantee 3: off is silent', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  for (const [label, enabled, paused] of [
    ['a disabled folder', false, false],
    ['a folder while the app is paused', true, true],
  ] as const) {
    it(`${label}: the watcher closes, and nothing runs git again`, async () => {
      const { a } = await twoComputers()
      const cfg: FolderConfig = { id: 'a', path: a.root, enabled: true }
      // Every trigger at its hair-trigger setting (the idle poll aside: it would keep a pass in flight forever).
      const manager = createSyncManager(gitHost('Mac-A', { watch: watchFolder, quietMs: 0, wakeCooldownMs: 0, retryMs: 0, peekMs: 0 }))
      manager.setFolders([cfg], false)
      await until(() => manager.folders()[0]?.state === 'synced')

      manager.setFolders([{ ...cfg, enabled }], paused)
      vi.mocked(git).mockClear()
      for (let i = 0; i < 20; i += 1) await a.write(`n${i}.md`, `${i}\n`)
      manager.notifyWake()
      await manager.syncNow(null)
      await manager.syncNow('a')
      await manager.flushForQuit()
      await new Promise((r) => setTimeout(r, 300)) // give the (polling) watcher every chance to misbehave

      expect(vi.mocked(git).mock.calls.filter(([, root]) => root === a.root)).toEqual([])
      expect(manager.folders()[0]?.state).toBe('off')
    })
  }
})

describe('guarantee 4: no git is a classification, not a crash', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('reports attention/no-git through the manager', async () => {
    const { a } = await twoComputers()
    let last: FolderStatus | undefined
    const manager = createSyncManager({
      ...gitHost('Mac-A'),
      sync: (root, opts) => syncFolder(root, { ...opts, host: 'Mac-A', candidates: [] }),
      onChange: () => {
        last = manager.folders()[0]
      },
    })
    manager.setFolders([{ id: 'a', path: a.root, enabled: true }], false)
    await until(() => last?.state === 'attention')
    expect(last?.attention).toEqual({ kind: 'no-git' })
  })
})

describe('guarantee 5: quit flush lands pending changes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('commits and pushes before resolving', async () => {
    const { a, remote } = await twoComputers()
    const manager = createSyncManager(gitHost('Mac-A'))
    manager.setFolders([{ id: 'a', path: a.root, enabled: true }], false)
    await until(() => manager.folders()[0]?.state === 'synced')
    await a.write('note.md', 'line one\nline two\nadded just before quit\n')

    await manager.flushForQuit()

    expect(await remoteHead(a, remote)).toBe(await a.run(['rev-parse', 'HEAD']))
    expect(await a.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): note.md')
  })
})
