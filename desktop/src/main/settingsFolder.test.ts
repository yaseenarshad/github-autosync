import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/status'
import type { RepoSettings } from '@shared/types'
import { tempDir } from './git/gitFixture'
import { createRegistry, newFolder, settingsOf, withRepoSettings, type Registry } from './registry'
import { followSettingsFolder, parseSettingsFile, settingsFileName, type SettingsFolder } from './settingsFolder'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function dir(name: string): Promise<string> {
  const d = await tempDir(name)
  cleanups.push(() => rm(d, { recursive: true, force: true }))
  return d
}

const LAB = 'https://github.com/Acme/Lab.git'
const NOTES = 'git@github.com:acme/notes.git'
const HOUR: RepoSettings = { push: 60, pull: 5, paths: ['docs'], beforePush: null }

/** One "computer": its own userData, the given repos, all pointed at `shared`. */
async function computer(name: string, shared: string, remotes: string[]): Promise<{ registry: Registry; folder: SettingsFolder; changes: () => number }> {
  const registry = createRegistry(await dir(name))
  registry.update((c) => ({ ...c, settingsFolder: shared, folders: remotes.map((r) => newFolder(`/Users/${name}/${path.basename(r, '.git')}`, r)) }))
  let n = 0
  const folder = followSettingsFolder(registry, { host: name, onChange: () => (n += 1), debounceMs: 5, retryMs: 20, rereadMs: 50 })
  cleanups.push(() => folder.close())
  await folder.ready
  return { registry, folder, changes: () => n }
}

/** Say "the registry changed" and wait for the write. */
async function save(c: { registry: Registry; folder: SettingsFolder }, key: string, settings: RepoSettings, savedAt: number): Promise<void> {
  c.registry.update((cfg) => withRepoSettings(cfg, key, settings, savedAt))
  c.folder.changed()
  await c.folder.flush()
}

describe('the settings folder (D35, D36)', () => {
  it('carries a change from one computer to the other and back, each writing only its own file', async () => {
    const shared = await dir('sync')
    const a = await computer('mac-a', shared, [LAB])
    const b = await computer('mac-b', shared, [LAB])

    await save(a, 'github.com/acme/lab', HOUR, 100)
    await vi.waitFor(() => expect(settingsOf(b.registry.get(), b.registry.get().folders[0]!)).toEqual(HOUR))

    await save(b, 'github.com/acme/lab', { ...HOUR, push: 'manual' }, 200)
    await vi.waitFor(() => expect(a.registry.get().repos['github.com/acme/lab']).toEqual({ settings: { ...HOUR, push: 'manual' }, savedAt: 200 }))

    expect(readdirSync(shared).sort()).toEqual([settingsFileName(a.registry.get().macId), settingsFileName(b.registry.get().macId)].sort())
    const file = parseSettingsFile('x', readFileSync(path.join(shared, settingsFileName(a.registry.get().macId)), 'utf8'))
    expect(file?.repos['github.com/acme/lab']).toEqual({ remoteUrl: LAB, path: '/Users/mac-a/Lab', syncing: true, savedAt: 200, settings: { ...HOUR, push: 'manual' } })
  })

  it('keeps the newest change per repo, so two repos changed on two computers both stay', async () => {
    const shared = await dir('sync')
    const a = await computer('mac-a', shared, [LAB, NOTES])
    const b = await computer('mac-b', shared, [LAB, NOTES])

    await save(a, 'github.com/acme/lab', HOUR, 300)
    await save(b, 'github.com/acme/notes', { ...DEFAULT_SETTINGS, pull: 15 }, 400)

    for (const c of [a, b]) {
      await vi.waitFor(() => {
        expect(c.registry.get().repos['github.com/acme/lab']?.settings).toEqual(HOUR)
        expect(c.registry.get().repos['github.com/acme/notes']?.settings.pull).toBe(15)
      })
    }
  })

  it('skips a half-synced file, then reads it once it is whole', async () => {
    const shared = await dir('sync')
    const a = await computer('mac-a', shared, [LAB])
    const other = path.join(shared, 'settings-0123456789ab.json')
    writeFileSync(other, '{"repos": {"github.com/acme/lab": {"remoteUrl"')
    a.folder.changed()
    await a.folder.settled()
    expect(a.registry.get().repos).toEqual({})

    const whole = { name: 'mac-c', repos: { 'github.com/acme/lab': { remoteUrl: LAB, path: '/x', syncing: true, savedAt: 500, settings: { ...HOUR, pull: 'sometimes' } } } }
    writeFileSync(other, JSON.stringify(whole))
    // A field this build cannot read keeps this computer's value (D36).
    await vi.waitFor(() => expect(a.registry.get().repos['github.com/acme/lab']).toEqual({ settings: { ...HOUR, pull: DEFAULT_SETTINGS.pull }, savedAt: 500 }))
    expect(a.folder.others().map((f) => f.name)).toEqual(['mac-c'])
  })

  it('says the folder is missing, keeps its own settings, and recovers when the folder comes back', async () => {
    const shared = path.join(await dir('sync'), 'later')
    const a = await computer('mac-a', shared, [LAB])
    await a.folder.settled()
    expect(a.folder.missing()).toBe(true)

    mkdirSync(shared)
    await vi.waitFor(() => expect(a.folder.missing()).toBe(false))
    await vi.waitFor(() => expect(readdirSync(shared)).toEqual([settingsFileName(a.registry.get().macId)]))
    expect(a.changes()).toBeGreaterThan(0)
  })
})
