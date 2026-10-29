import { existsSync, mkdirSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/status'
import { makeBareRemote, makeGitRepo, REAL_GIT_TIMEOUT_MS, tempDir, wireOrigin } from './git/gitFixture'
import { cloneInto, findClones, onThisComputer, othersFrom } from './others'
import { createRegistry, newFolder, type Config } from './registry'
import type { MacFile } from './settingsFolder'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function dir(name: string): Promise<string> {
  const d = await tempDir(name)
  cleanups.push(() => rm(d, { recursive: true, force: true }))
  return d
}

const repo = (remoteUrl: string, p: string, syncing = true) => ({ remoteUrl, path: p, syncing, savedAt: 1, settings: DEFAULT_SETTINGS })

async function config(folders: Config['folders'], hiddenRepos: string[] = []): Promise<Config> {
  return createRegistry(await dir('userdata')).update((c) => ({ ...c, folders, hiddenRepos }))
}

describe('the other computers’ repos (D53)', () => {
  it('swaps the other computer’s home folder for this one’s', () => {
    expect(onThisComputer('/Users/sam/Documents/GitHub/lab', '/Users/yasin')).toBe(path.join('/Users/yasin', 'Documents', 'GitHub', 'lab'))
    expect(onThisComputer('C:\\Users\\sam\\code\\lab', '/Users/yasin')).toBe(path.join('/Users/yasin', 'code', 'lab'))
    expect(onThisComputer('/srv/lab', '/Users/yasin')).toBe(path.join('/srv', 'lab'))
  })

  it('lists what another computer syncs and this one lacks, once per repo, with every computer that syncs it', async () => {
    const files: MacFile[] = [
      { macId: 'a', name: 'Mac-Studio', repos: { 'github.com/me/lab': repo('https://github.com/me/lab.git', '/Users/sam/GitHub/lab'), 'github.com/me/off': repo('git@github.com:me/off.git', '/Users/sam/off', false) } },
      { macId: 'b', name: 'MacBook-Air', repos: { 'github.com/me/lab': repo('https://github.com/me/lab.git', '/Users/sam/GitHub/lab'), 'github.com/me/notes': repo('git@github.com:me/notes.git', '/Users/sam/notes') } },
    ]
    const cfg = await config([newFolder('/Users/yasin/notes', 'https://github.com/Me/Notes.git')], ['github.com/me/lab'])
    expect(othersFrom(cfg, files, '/Users/yasin')).toEqual([
      { key: 'github.com/me/lab', name: 'lab', remoteUrl: 'https://github.com/me/lab.git', computers: ['Mac-Studio', 'MacBook-Air'], expectedPath: path.join('/Users/yasin', 'GitHub', 'lab'), found: null, cloning: false, error: null, hidden: true, gone: false, settings: DEFAULT_SETTINGS },
    ])
  })

  it(
    'finds a clone at the swapped path, or beside this computer’s synced folders',
    async () => {
      const remote = await makeBareRemote()
      cleanups.push(remote.cleanup)
      const home = await dir('home')
      const synced = path.join(home, 'GitHub', 'synced')
      mkdirSync(synced, { recursive: true })
      const key = remote.url // a non-GitHub origin is its own key (D34)
      const others = othersFrom(await config([]), [{ macId: 'a', name: 'Mac-Studio', repos: { [key]: repo(remote.url, '/Users/sam/elsewhere/lab') } }], home)

      // Not at the swapped path, but beside a synced folder under another name.
      const clone = await makeGitRepo()
      cleanups.push(clone.cleanup)
      await wireOrigin(clone, remote)
      const beside = path.join(home, 'GitHub', 'my-lab')
      await rename(clone.root, beside)
      const found = await findClones(others, await config([newFolder(synced)]))
      expect(found[0]?.found).toBe(beside)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('a repo gone from its remote (item 35)', () => {
  it(
    'is marked gone when the remote is not there, and not when it is',
    async () => {
      const remote = await makeBareRemote()
      cleanups.push(remote.cleanup)
      const missing = path.join(await dir('nothing'), 'deleted.git')
      const others = othersFrom(
        await config([]),
        [{ macId: 'a', name: 'Mac-Studio', repos: { live: repo(remote.url, '/Users/sam/live'), dead: repo(missing, '/Users/sam/dead') } }],
        '/nowhere',
      )
      const found = await findClones(others, await config([]))
      expect(Object.fromEntries(found.map((o) => [o.key, o.gone]))).toEqual({ dead: true, live: false })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('Clone… (D54)', () => {
  it(
    'clones into the parent and answers the new folder; a folder that is there stops it; a failure leaves nothing behind',
    async () => {
      const remote = await makeBareRemote()
      cleanups.push(remote.cleanup)
      const seed = await makeGitRepo()
      cleanups.push(seed.cleanup)
      await wireOrigin(seed, remote)
      await seed.write('a.md', 'a\n')
      await seed.run(['add', '-A'])
      await seed.run(['commit', '-qm', 'base'])
      await seed.run(['push', '-q', '-u', 'origin', 'HEAD'])
      const parent = await dir('parent')

      const done = await cloneInto(remote.url, parent, 'lab')
      expect(done).toEqual({ ok: true, path: path.join(parent, 'lab') })
      expect(existsSync(path.join(parent, 'lab', 'a.md'))).toBe(true)

      const again = await cloneInto(remote.url, parent, 'lab')
      expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already has a folder named lab/) })

      const bad = await cloneInto(path.join(parent, 'no-such-remote'), parent, 'gone')
      expect(bad.ok).toBe(false)
      expect(existsSync(path.join(parent, 'gone'))).toBe(false)
      expect(existsSync(path.join(parent, 'lab', 'a.md'))).toBe(true) // the folder that was there is untouched
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
