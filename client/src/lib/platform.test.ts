import { expect, it } from 'vitest'
import { platformFor } from './platform'

it('uses Mac words and ⌘ on a Mac', () => {
  const p = platformFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/43.4.1')
  expect(p).toMatchObject({ mac: true, here: 'this Mac', fileManager: 'Finder' })
  expect(p.shortcut('F')).toBe('⌘⇧F')
})

it('uses neutral words and Ctrl everywhere else', () => {
  const p = platformFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/43.4.1')
  expect(p).toMatchObject({ mac: false, here: 'this computer', yours: 'your computer', fileManager: 'File Explorer' })
  expect(p.shortcut('G')).toBe('Ctrl+Shift+G')
})
