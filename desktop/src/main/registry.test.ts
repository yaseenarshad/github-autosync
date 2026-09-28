import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tempDir } from './git/gitFixture'
import { createRegistry, newFolder, withAlias } from './registry'

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
    expect(createRegistry(d).get()).toEqual({ version: 1, folders: [], launchAtLogin: true, paused: false, theme: 'system' })
    expect(existsSync(path.join(d, 'config.json'))).toBe(false)
  })

  it('round-trips through config.json, leaving no temp file behind', async () => {
    const d = await dir()
    const folder = newFolder('/Users/me/notes')
    createRegistry(d).update((c) => ({ ...c, folders: [folder], paused: true, launchAtLogin: false, theme: 'dark' }))

    expect(createRegistry(d).get()).toEqual({ version: 1, folders: [folder], launchAtLogin: false, paused: true, theme: 'dark' })
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
      expect(createRegistry(d).get()).toEqual({ version: 1, folders: [], launchAtLogin: true, paused: false, theme: 'system' })
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
    expect(createRegistry(d).get()).toEqual({ version: 1, folders: [folder], launchAtLogin: true, paused: false, theme: 'system' })
  })
})
