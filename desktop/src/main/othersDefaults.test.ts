import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/status'
import { tempDir } from './git/gitFixture'
import { othersFrom } from './others'
import { createRegistry, newFolder, settingsOf } from './registry'
import { parseSettingsFile, settingsFileText } from './settingsFolder'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('checker 9H: the Sync… sheet shows the settings the repo really starts with (D58, item 19)', () => {
  it('a repo nobody changed starts with this computer’s defaults, and the sheet says so', async () => {
    const LAB = 'https://github.com/acme/lab.git'
    // Mac A added the repo and never changed its settings: its file has the built-in defaults, savedAt 0.
    const aData = await tempDir('mac-a')
    cleanups.push(() => rm(aData, { recursive: true, force: true }))
    const a = createRegistry(aData).update((c) => ({ ...c, folders: [newFolder('/Users/sam/GitHub/lab', LAB)] }))
    const file = parseSettingsFile('aaaaaaaaaaaa', settingsFileText(a, 'Mac-A'))
    if (file === null) throw new Error('no file')
    // This computer: "New repos start with" = push every 1 hour, pull every 5 min.
    const bData = await tempDir('mac-b')
    cleanups.push(() => rm(bData, { recursive: true, force: true }))
    const b = createRegistry(bData).update((c) => ({ ...c, defaults: { push: 60, pull: 5 } }))
    const [other] = othersFrom(b, [file], '/Users/yasin')
    // What "Start syncing" gives the new folder:
    const runsWith = settingsOf(b, newFolder('/Users/yasin/GitHub/lab', LAB))
    expect(runsWith).toEqual({ ...DEFAULT_SETTINGS, push: 60, pull: 5 })
    expect(other?.settings).toEqual(runsWith)
  })
})
