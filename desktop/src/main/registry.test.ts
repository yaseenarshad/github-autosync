import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tempDir } from './git/gitFixture'
import { DEFAULT_SETTINGS } from '@shared/status'
import { createRegistry, MAC_ID, newFolder, settingsOf, withAlias, withLearnedRemotes, withRepoSettings } from './registry'

/** What a fresh registry holds: a new random computer id, nothing else set. */
const DEFAULTS = { version: 1, folders: [], launchAtLogin: true, paused: false, theme: 'system', macId: expect.stringMatching(MAC_ID), settingsFolder: null, repos: {}, hiddenRepos: [], defaults: { push: 'auto', pull: 1 } }

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function dir(): Promise<string> {
  const d = await tempDir('userdata')
  cleanups.push(() => rm(d, { recursive: true, force: true }))
  return d
}

describe('registry (D5)', () => {
  it('starts from defaults and writes nothing until something changes', async () => {
    const d = await dir()
    expect(createRegistry(d).get()).toEqual(DEFAULTS)
    expect(existsSync(path.join(d, 'config.json'))).toBe(false)
  })

  it('round-trips through config.json, leaving no temp file behind', async () => {
    const d = await dir()
    const folder = newFolder('/Users/me/notes')
    createRegistry(d).update((c) => ({ ...c, folders: [folder], paused: true, launchAtLogin: false, theme: 'dark' }))

    expect(createRegistry(d).get()).toEqual({ ...DEFAULTS, folders: [folder], launchAtLogin: false, paused: true, theme: 'dark' })
    expect(JSON.parse(readFileSync(path.join(d, 'config.json'), 'utf8')).folders[0]).toEqual({ id: folder.id, path: '/Users/me/notes', enabled: true })
    expect(existsSync(path.join(d, 'config.json.tmp'))).toBe(false)
  })

  it('never lets a change mutate the config it was handed', async () => {
    const registry = createRegistry(await dir())
    const before = registry.get()
    registry.update((c) => {
      c.folders.push(newFolder('/x'))
      return c
    })
    expect(before.folders).toEqual([])
    expect(registry.get().folders).toHaveLength(1)
  })

  it.each([['{not json'], ['{"version":2,"folders":[],"launchAtLogin":true,"paused":false}'], ['{"version":1,"folders":[{"id":1}],"launchAtLogin":true,"paused":false}'], ['null'], ['{"version":1,"folders":[],"launchAtLogin":true,"paused":false,"theme":"sepia"}']])(
    'moves a malformed file (%s) aside to config.json.bak and starts from defaults',
    async (raw) => {
      const d = await dir()
      writeFileSync(path.join(d, 'config.json'), raw)
      expect(createRegistry(d).get()).toEqual(DEFAULTS)
      expect(readFileSync(path.join(d, 'config.json.bak'), 'utf8')).toBe(raw)
      expect(existsSync(path.join(d, 'config.json'))).toBe(false)
    },
  )

  it('refuses to write a change the next launch would reject, keeping the file and the config as they were', async () => {
    const d = await dir()
    const registry = createRegistry(d)
    registry.update((c) => ({ ...c, folders: [newFolder('/Users/me/notes')] }))
    const saved = readFileSync(path.join(d, 'config.json'), 'utf8')
    const before = registry.get()

    expect(() => registry.update((c) => ({ ...c, theme: 'sepia' as never }))).toThrow(/malformed/)
    expect(() => registry.update((c) => ({ ...c, folders: [{ id: 'x', path: '/x', enabled: 'yes' as never }] }))).toThrow(/malformed/)

    expect(registry.get()).toBe(before)
    expect(readFileSync(path.join(d, 'config.json'), 'utf8')).toBe(saved)
    expect(createRegistry(d).get()).toEqual(before)
  })

  it('gives every folder a stable random id', () => {
    const a = newFolder('/a')
    const b = newFolder('/a')
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.id).not.toBe(b.id)
  })

  it('stores a trimmed nickname, drops a blank one, and round-trips it', async () => {
    const d = await dir()
    const folder = newFolder('/Users/me/notes')
    expect(withAlias(folder, '  Work notes ')).toEqual({ ...folder, alias: 'Work notes' })
    expect(withAlias({ ...folder, alias: 'Old' }, '   ')).toEqual(folder)
    expect(withAlias({ ...folder, alias: 'Old' }, null)).toEqual(folder)

    createRegistry(d).update((c) => ({ ...c, folders: [withAlias(folder, 'Work notes')] }))
    expect(createRegistry(d).get().folders).toEqual([{ ...folder, alias: 'Work notes' }])
  })

  it('treats a non-string nickname as a malformed file', async () => {
    const d = await dir()
    writeFileSync(path.join(d, 'config.json'), JSON.stringify({ version: 1, folders: [{ id: 'x', path: '/x', enabled: true, alias: 3 }], launchAtLogin: true, paused: false }))
    expect(createRegistry(d).get().folders).toEqual([])
  })

  it('reads a config written before the theme setting existed as theme `system`, folders intact (D19)', async () => {
    const d = await dir()
    const folder = newFolder('/x')
    writeFileSync(path.join(d, 'config.json'), JSON.stringify({ version: 1, folders: [folder], launchAtLogin: true, paused: false }))
    expect(createRegistry(d).get()).toEqual({ ...DEFAULTS, folders: [folder] })
  })

  it('reads a config from before D34/D35 with no settings, keeps its folders, and keeps one computer id once written', async () => {
    const d = await dir()
    const folder = newFolder('/x')
    writeFileSync(path.join(d, 'config.json'), JSON.stringify({ version: 1, folders: [folder], launchAtLogin: true, paused: false, theme: 'dark' }))
    const registry = createRegistry(d)
    expect(registry.get()).toEqual({ ...DEFAULTS, folders: [folder], theme: 'dark' })
    const { macId } = registry.update((c) => c)
    expect(createRegistry(d).get().macId).toBe(macId)
  })

  it('round-trips repo settings, the settings folder and the hidden list, and never stores a folder runtime settings', async () => {
    const d = await dir()
    const folder = { ...newFolder('/Users/me/lab', 'git@github.com:Me/Lab.git'), settings: DEFAULT_SETTINGS }
    const settings = { push: 60, pull: 5, paths: ['yaseen/docs'], beforePush: './save-for-git.sh' }
    createRegistry(d).update((c) => withRepoSettings({ ...c, folders: [folder], settingsFolder: '/Users/me/Sync/autosync', hiddenRepos: ['github.com/me/old'] }, 'github.com/me/lab', settings, 42))

    const loaded = createRegistry(d).get()
    expect(loaded.repos).toEqual({ 'github.com/me/lab': { settings, savedAt: 42 } })
    expect(loaded.settingsFolder).toBe('/Users/me/Sync/autosync')
    expect(loaded.hiddenRepos).toEqual(['github.com/me/old'])
    expect(loaded.folders[0]).toEqual({ id: folder.id, path: '/Users/me/lab', enabled: true, remote: 'git@github.com:Me/Lab.git' })
    // Any spelling of the origin finds the repo's settings (D34); a folder with no origin yet runs on the defaults.
    expect(settingsOf(loaded, loaded.folders[0]!)).toEqual(settings)
    expect(settingsOf(loaded, newFolder('/y'))).toEqual(DEFAULT_SETTINGS)
  })

  it.each([
    [{ push: 0, pull: 1, paths: null, beforePush: null }],
    [{ push: 'auto', pull: 'sometimes', paths: null, beforePush: null }],
    [{ push: 'auto', pull: 1, paths: ['../escape'], beforePush: null }],
    [{ push: 'auto', pull: 1, paths: ['/abs'], beforePush: null }],
    [{ push: 'auto', pull: 1, paths: [], beforePush: null }],
    [{ push: 'auto', pull: 1, paths: null, beforePush: '  ' }],
  ])('refuses to save repo settings it could not load again (%j)', async (bad) => {
    const registry = createRegistry(await dir())
    expect(() => registry.update((c) => ({ ...c, repos: { k: { settings: bad as never, savedAt: 1 } } }))).toThrow(/malformed/)
  })

  it('moves a repo’s settings to its new key when its origin changes (a rename on GitHub, item 32)', async () => {
    const registry = createRegistry(await dir())
    const folder = newFolder('/Users/me/lab', 'https://github.com/me/old-name.git')
    const settings = { push: 60 as const, pull: 5 as const, paths: ['docs'], beforePush: null }
    const config = registry.update((c) => withRepoSettings({ ...c, folders: [folder] }, 'github.com/me/old-name', settings, 7))
    expect(withLearnedRemotes(config, new Map([[folder.id, folder.remote ?? null]]))).toBeNull()
    const next = withLearnedRemotes(config, new Map([[folder.id, 'git@github.com:Me/New-Name.git']]))
    expect(next?.folders[0]?.remote).toBe('git@github.com:Me/New-Name.git')
    expect(next?.repos['github.com/me/new-name']).toEqual({ settings, savedAt: 7 })
    expect(settingsOf(next!, next!.folders[0]!)).toEqual(settings)
  })
})
