import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { FolderStatus } from '@shared/types'
import { folderMenuTemplate, type FolderMenuActions, type FolderMenuContext } from './folderMenu'
import { makeFolder } from '@shared/testFixtures'

const MAC: FolderMenuContext = { paused: false, gitMissing: false, platform: 'darwin' }

function actions(): { [K in keyof FolderMenuActions]: ReturnType<typeof vi.fn> } {
  return { navigate: vi.fn(), syncNow: vi.fn(), copy: vi.fn(), viewOnGitHub: vi.fn(), showInFinder: vi.fn(), openInTerminal: vi.fn(), openInEditor: vi.fn(), clearAlias: vi.fn() }
}

const labels = (items: MenuItemConstructorOptions[]) => items.map((i) => (i.type === 'separator' ? '---' : i.label))
const item = (items: MenuItemConstructorOptions[], label: string) => items.find((i) => i.label === label) as MenuItemConstructorOptions
const click = (items: MenuItemConstructorOptions[], label: string) => (item(items, label).click as () => void)()

describe('folderMenuTemplate (D18)', () => {
  it('lists every item, grouped, for a GitHub folder that needs the user and has a nickname', () => {
    const f = makeFolder({ alias: 'Notes', name: 'Notes', state: 'attention', attention: { kind: 'auth' } })
    expect(labels(folderMenuTemplate(f, MAC, actions()))).toEqual([
      'Sync now',
      'Turn off syncing…',
      '---',
      'Copy folder name',
      'Copy path',
      'Copy GitHub URL',
      'Copy AI prompt',
      '---',
      'View on GitHub',
      'Reveal in Finder',
      'Open in Terminal',
      'Open in VS Code',
      '---',
      'Rename in AutoSync…',
      'Remove nickname',
      '---',
      'Remove…',
    ])
  })

  it('drops what does not apply: no GitHub URL, no attention, no nickname, a disabled folder', () => {
    const f = makeFolder({ webUrl: null, enabled: false, state: 'off' })
    expect(labels(folderMenuTemplate(f, MAC, actions()))).toEqual([
      'Sync now',
      'Turn on syncing…',
      '---',
      'Copy folder name',
      'Copy path',
      '---',
      'Reveal in Finder',
      'Open in Terminal',
      'Open in VS Code',
      '---',
      'Rename in AutoSync…',
      '---',
      'Remove…',
    ])
  })

  it.each<[string, Partial<FolderStatus>, Partial<FolderMenuContext>, boolean]>([
    ['a synced folder', {}, {}, true],
    ['a disabled folder', { enabled: false, state: 'off' }, {}, false],
    ['the app paused', { state: 'off' }, { paused: true }, false],
    ['git missing', { state: 'attention', attention: { kind: 'no-git' } }, { gitMissing: true }, false],
  ])('Sync now for %s: enabled = %s', (_label, over, ctx, enabled) => {
    expect(item(folderMenuTemplate(makeFolder(over), { ...MAC, ...ctx }, actions()), 'Sync now').enabled).toBe(enabled)
  })

  it('uses Windows words on Windows', () => {
    const items = folderMenuTemplate(makeFolder(), { ...MAC, platform: 'win32' }, actions())
    expect(labels(items)).toContain('Reveal in File Explorer')
    expect(labels(items)).toContain('Open in Command Prompt')
  })

  it('wires each click: sheets through the window, copies straight to the clipboard, the rest to its action', () => {
    const a = actions()
    const f = makeFolder({ alias: 'Notes', name: 'Notes', attention: { kind: 'auth' }, state: 'attention' })
    const items = folderMenuTemplate(f, MAC, a)
    for (const label of ['Turn off syncing…', 'Copy AI prompt', 'Rename in AutoSync…', 'Remove…', 'Copy folder name', 'Copy path', 'Copy GitHub URL', 'Sync now', 'View on GitHub', 'Reveal in Finder', 'Open in Terminal', 'Open in VS Code', 'Remove nickname']) click(items, label)
    expect(a.navigate.mock.calls.map(([t]) => t)).toEqual([
      { folderId: 'notes', sheet: 'folder-off' },
      { folderId: 'notes', copyPrompt: true },
      { folderId: 'notes', sheet: 'rename' },
      { folderId: 'notes', sheet: 'remove' },
    ])
    expect(a.copy.mock.calls.map(([t]) => t)).toEqual(['Notes', '/Users/yasin/Documents/GitHub/notes', 'https://github.com/yasin/notes'])
    expect(a.viewOnGitHub).toHaveBeenCalledWith('https://github.com/yasin/notes')
    for (const fn of [a.syncNow, a.showInFinder, a.openInTerminal, a.openInEditor, a.clearAlias]) expect(fn).toHaveBeenCalledOnce()
    click(folderMenuTemplate(makeFolder({ enabled: false, state: 'off' }), MAC, a), 'Turn on syncing…')
    expect(a.navigate).toHaveBeenLastCalledWith({ folderId: 'notes', sheet: 'folder-on' })
  })
})
