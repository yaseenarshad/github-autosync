import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderStatus, RepoSettings } from '@shared/types'
import { repoKey } from '../git/detect'
import { gitHost, pushedRepo, REAL_GIT_TIMEOUT_MS, remoteHead, tempDir } from '../git/gitFixture'
import { createSyncManager, type SyncManager } from '../git/manager'
import { cloneInto, othersFrom } from '../others'
import { createRegistry, newFolder, settingsOf, withRepoSettings, type Registry } from '../registry'
import { followSettingsFolder, type SettingsFolder } from '../settingsFolder'

/**
 * YAZ-3701 end to end: two computers, one GitHub, one settings folder. Each computer has its own
 * registry, settings folder follower and real manager over the real pass. The test plays the user
 * (settings, edits, Add) and the clock (`syncNow` for a push that is due, a wake for a pull).
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function dir(name: string): Promise<string> {
  const d = await tempDir(name)
  // Windows holds a folder for a moment after the watcher and git let go (EBUSY): try again.
  cleanups.push(() => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))
  return d
}

interface Computer {
  registry: Registry
  folder: SettingsFolder
  manager: SyncManager
  status: () => FolderStatus
  /** Hands the registry's folders, with their repos' settings, to the manager — what `apply()` does. */
  apply: () => void
}

async function computer(host: string, shared: string): Promise<Computer> {
  const registry = createRegistry(await dir(`${host}-userdata`))
  registry.update((c) => ({ ...c, settingsFolder: shared }))
  const manager = createSyncManager(gitHost(host, { wakeCooldownMs: 0 }))
  const apply = () => {
    const config = registry.get()
    manager.setFolders(config.folders.map((f) => ({ ...f, settings: settingsOf(config, f) })), false)
  }
  const folder = followSettingsFolder(registry, { host, onChange: apply, debounceMs: 5, retryMs: 20, rereadMs: 50 })
  await folder.ready
  cleanups.push(async () => {
    manager.setFolders([], false)
    await folder.close()
  })
  return { registry, folder, manager, apply, status: () => manager.folders()[0] as FolderStatus }
}

/** Real git on a cold CI runner (Windows) takes seconds; `vi.waitFor` waits 1 s by default. */
const SLOW = { timeout: 15_000, interval: 50 }

const HOURLY_DOCS: RepoSettings = { push: 60, pull: 5, paths: ['docs'], beforePush: null }

describe('YAZ-3701: settings that travel, picked folders, one commit per push', { timeout: REAL_GIT_TIMEOUT_MS * 3 }, () => {
  it('Mac B adds the repo Mac A syncs with A’s settings; each pushes only docs, as one commit, and pulls the other’s', async () => {
    const { repo: aRepo, remote, cleanup } = await pushedRepo({ 'docs/start.md': 'start\n', 'app/main.ts': 'main\n' })
    cleanups.push(cleanup)
    const key = repoKey(remote.url)
    // Made before the computers, so it is removed after they stop (cleanups run newest first; Windows will not remove a folder in use).
    const parent = await dir('mac-b-github')
    const shared = await dir('settings')
    const a = await computer('Mac-A', shared)
    const b = await computer('Mac-B', shared)

    // Mac A syncs the repo, then sets push 1 h, pull 5 min, docs only.
    a.registry.update((c) => withRepoSettings({ ...c, folders: [newFolder(aRepo.root, remote.url)] }, key, HOURLY_DOCS))
    a.apply()
    a.folder.changed()
    await a.folder.flush()
    await vi.waitFor(() => expect(a.status().lastCheckedAt).not.toBeNull(), SLOW)

    // Mac B lists it under "On your other computers", with A's settings already in hand.
    await vi.waitFor(() => expect(othersFrom(b.registry.get(), b.folder.others(), '/nowhere').map((o) => [o.key, o.computers])).toEqual([[key, ['Mac-A']]]), SLOW)
    expect(b.registry.get().repos[key]?.settings).toEqual(HOURLY_DOCS)

    // Clone…, then the folder is added: it runs with A's settings at once.
    mkdirSync(parent, { recursive: true })
    const cloned = await cloneInto(remote.url, parent, 'lab')
    if (!cloned.ok) throw new Error(cloned.error)
    b.registry.update((c) => ({ ...c, folders: [newFolder(cloned.path, remote.url)] }))
    b.apply()
    expect(b.status().settings).toEqual(HOURLY_DOCS)
    await vi.waitFor(() => expect(b.status().lastCheckedAt).not.toBeNull(), SLOW)

    // A edits docs twice with a pull between: nothing reaches GitHub before the push is due.
    const start = await remoteHead(aRepo, remote)
    const write = async (root: string, rel: string, text: string) => {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
      await writeFile(path.join(root, rel), text)
    }
    await write(aRepo.root, 'docs/one.md', 'one\n')
    a.manager.notifyWake() // a wake pulls; it never pushes a timer repo (D39)
    await vi.waitFor(() => expect(a.status().pending.map((c) => c.path)).toContain('docs/one.md'), SLOW)
    await write(aRepo.root, 'docs/two.md', 'two\n')
    await write(aRepo.root, 'app/local.db', 'stays here\n')
    expect(await remoteHead(aRepo, remote)).toBe(start)

    // The push is due: one commit with both docs; the file outside the picks stays (D41, D44).
    await a.manager.syncNow(null)
    expect(a.status()).toMatchObject({ state: 'synced', pending: [], outside: [{ status: 'A', path: 'app/local.db' }] })
    const subjects = (await aRepo.run(['log', '--format=%s', 'origin/main'])).split('\n')
    expect(subjects[0]).toBe('sync (Mac-A): docs — one.md, two.md')
    expect(subjects).toHaveLength(2)

    // B pulls on a wake and has A's docs, but not A's local file.
    b.manager.notifyWake()
    await vi.waitFor(() => expect(existsSync(path.join(cloned.path, 'docs', 'two.md'))).toBe(true), SLOW)
    expect(existsSync(path.join(cloned.path, 'app', 'local.db'))).toBe(false)
  })
})
