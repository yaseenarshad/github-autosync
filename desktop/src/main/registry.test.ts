import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tempDir } from './git/gitFixture'
import { createRegistry, newFolder } from './registry'

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
    expect(createRegistry(d).get()).toEqual({ version: 1, folders: [], launchAtLogin: true, paused: false })
    expect(existsSync(path.join(d, 'config.json'))).toBe(false)
  })

  it('round-trips through config.json, leaving no temp file behind', async () => {
    const d = await dir()
    const folder = newFolder('/Users/me/notes')
    createRegistry(d).update((c) => ({ ...c, folders: [folder], paused: true, launchAtLogin: false }))

    expect(createRegistry(d).get()).toEqual({ version: 1, folders: [folder], launchAtLogin: false, paused: true })
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

  it.each([['{not json'], ['{"version":2,"folders":[],"launchAtLogin":true,"paused":false}'], ['{"version":1,"folders":[{"id":1}],"launchAtLogin":true,"paused":false}'], ['null']])(
    'moves a malformed file (%s) aside to config.json.bak and starts from defaults',
    async (raw) => {
      const d = await dir()
      writeFileSync(path.join(d, 'config.json'), raw)
      expect(createRegistry(d).get()).toEqual({ version: 1, folders: [], launchAtLogin: true, paused: false })
      expect(readFileSync(path.join(d, 'config.json.bak'), 'utf8')).toBe(raw)
      expect(existsSync(path.join(d, 'config.json'))).toBe(false)
    },
  )

  it('gives every folder a stable random id', () => {
    const a = newFolder('/a')
    const b = newFolder('/a')
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.id).not.toBe(b.id)
  })
})
