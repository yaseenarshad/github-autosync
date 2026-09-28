import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AutoSyncApi } from '@shared/api'
import type { ActivityPage, AppStatus, NavTarget } from '@shared/types'
import { App } from './App'
import { platform } from './lib/platform'
import { makeEntry, makeFolder, makeStatus } from './test/fixtures'

let root: Root
let container: HTMLElement
let navigate: (target: NavTarget) => void

function mockApi(status: AppStatus) {
  const api = {
    getStatus: vi.fn(async () => status),
    onStatus: vi.fn(() => () => {}),
    onNavigate: vi.fn((listener: (target: NavTarget) => void) => {
      navigate = listener
      return () => {}
    }),
    pickFolder: vi.fn(),
    checkFolder: vi.fn(),
    addFolder: vi.fn(),
    removeFolder: vi.fn(async () => status),
    setFolderEnabled: vi.fn(async () => status),
    setPaused: vi.fn(async () => status),
    syncNow: vi.fn(async () => {}),
    activity: vi.fn(async (): Promise<ActivityPage> => ({ entries: [], cursor: null })),
    setLaunchAtLogin: vi.fn(),
    setTheme: vi.fn(async () => status),
    showInFinder: vi.fn(),
    openExternal: vi.fn(),
    copyText: vi.fn(),
    showFolderMenu: vi.fn(async () => {}),
    setAlias: vi.fn(async () => status),
    openInTerminal: vi.fn(),
    openInEditor: vi.fn(),
  } satisfies AutoSyncApi
  window.autosync = api
  return api
}

async function mount(status: AppStatus) {
  const api = mockApi(status)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  await act(async () => root.render(<App />))
  return api
}

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function click(el: HTMLElement) {
  await act(async () => el.click())
}

const dialog = () => document.querySelector('[role="dialog"]')

async function shortcut(key: string) {
  const mod = platform.mac ? { metaKey: true } : { ctrlKey: true }
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, ...mod })))
}
const oneFolder = makeStatus([makeFolder({ id: 'notes', name: 'notes', lastSyncedAt: Date.now() })])

describe('confirmations (D15)', () => {
  it('turning a folder off waits for the confirm button', async () => {
    const api = await mount(oneFolder)
    await click(button('notes'))
    await click(document.querySelector<HTMLButtonElement>('[role="switch"]')!)

    expect(dialog()?.getAttribute('aria-label')).toBe('Turn off syncing for “notes”?')
    expect(document.activeElement).toBe(button('Cancel'))
    expect(api.setFolderEnabled).not.toHaveBeenCalled()

    await click(button('Turn off syncing'))
    expect(api.setFolderEnabled).toHaveBeenCalledWith('notes', false)
    expect(dialog()).toBeNull()
  })

  it('pause all waits for the confirm button; Cancel does nothing', async () => {
    const api = await mount(oneFolder)
    await click(button('Pause all'))
    expect(dialog()?.getAttribute('aria-label')).toBe('Pause syncing for all folders?')
    expect(document.activeElement).toBe(button('Cancel'))

    await click(button('Cancel'))
    expect(dialog()).toBeNull()
    expect(api.setPaused).not.toHaveBeenCalled()

    await click(button('Pause all'))
    await click(button('Pause all 1 folders'))
    expect(api.setPaused).toHaveBeenCalledWith(true)
  })

  it('Escape cancels', async () => {
    const api = await mount(oneFolder)
    await click(button('notes'))
    await click(button('Remove'))
    expect(dialog()?.getAttribute('aria-label')).toBe('Remove “notes”?')

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(dialog()).toBeNull()
    expect(api.removeFolder).not.toHaveBeenCalled()
  })
})

it('Sync all now acts immediately — it is not an on/off change', async () => {
  const api = await mount(oneFolder)
  await click(button('Sync all now'))
  expect(api.syncNow).toHaveBeenCalledWith(null)
})

it('shows the first-run screen with no folders', async () => {
  await mount(makeStatus([]))
  expect(container.textContent).toContain('Keep your folders in sync — automatically')
  expect(button('Sync all now').disabled).toBe(true)
})

it('folder page: problem card copies its prompt, activity collapses bursts', async () => {
  // Midday, so the whole history lands in "Today" (the only day open by default).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12))
  const now = Date.now()
  const folder = makeFolder({
    id: 'notes',
    name: 'notes',
    state: 'attention',
    attention: { kind: 'conflict', conflicts: [{ original: 'a.md', copy: 'a (conflict Mac-Studio, 2026-09-27).md' }] },
    lastSyncedAt: now,
  })
  const api = await mount(makeStatus([folder]))
  api.activity.mockResolvedValue({
    entries: [
      makeEntry({ sha: 'c1', time: now - 60_000, kind: 'conflict', host: 'Mac-Studio' }),
      makeEntry({ sha: 's1', time: now - 120_000 }),
      makeEntry({ sha: 's2', time: now - 180_000 }),
      makeEntry({ sha: 's3', time: now - 240_000 }),
      makeEntry({ sha: 'm1', time: now - 300_000, kind: 'manual', host: 'Yasin', subject: 'Tidy up' }),
    ],
    cursor: null,
  })
  await click(button('notes'))

  expect(container.textContent).toContain('Still syncing — but something needs you')
  expect(container.textContent).toContain('1 file was edited on two computers')
  expect(container.textContent).toContain(`Sent 3 times from ${platform.here}`)
  expect(container.textContent).toContain('Committed by Yasin: Tidy up')

  await click(button('Copy AI prompt'))
  expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining(folder.path))
  expect(button('Copied — paste into AI')).toBeTruthy()

  await click(button('I fixed it — check again'))
  expect(api.syncNow).toHaveBeenCalledWith('notes')
})

describe('folder shortcuts', () => {
  it('Reveal in file manager and View on GitHub act on the selected folder', async () => {
    const api = await mount(oneFolder)
    await click(button('notes'))
    await shortcut('F')
    expect(api.showInFinder).toHaveBeenCalledWith('notes')
    await shortcut('G')
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/yasin/notes')
  })

  it('do nothing on All folders or while a sheet is open', async () => {
    const api = await mount(oneFolder)
    await shortcut('F')
    await shortcut('G')
    await click(button('notes'))
    await click(button('Remove'))
    await shortcut('F')
    expect(api.showInFinder).not.toHaveBeenCalled()
    expect(api.openExternal).not.toHaveBeenCalled()
  })

  it('need the modifier and Shift', async () => {
    const api = await mount(oneFolder)
    await click(button('notes'))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true })))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true })))
    expect(api.showInFinder).not.toHaveBeenCalled()
  })
})

describe('folder right-click menu (D18)', () => {
  const rightClick = (el: Element) =>
    act(async () => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))

  it('right-clicking a sidebar or overview row asks main for the native menu', async () => {
    const api = await mount(oneFolder)
    await rightClick(document.querySelector('.ov-row')!)
    expect(api.showFolderMenu).toHaveBeenCalledWith('notes')
    expect(container.textContent).toContain('All folders')

    await rightClick(button('notes'))
    expect(api.showFolderMenu).toHaveBeenCalledTimes(2)
  })

  it('menu "Turn off syncing…" opens the confirm sheet, not the API', async () => {
    const api = await mount(oneFolder)
    await act(async () => navigate({ folderId: 'notes', sheet: 'folder-off' }))
    expect(dialog()?.getAttribute('aria-label')).toBe('Turn off syncing for “notes”?')
    expect(api.setFolderEnabled).not.toHaveBeenCalled()
  })

  it('rename saves the trimmed nickname, or clears it when blank', async () => {
    const api = await mount(oneFolder)
    const rename = async (value: string) => {
      await act(async () => navigate({ folderId: 'notes', sheet: 'rename' }))
      expect(dialog()?.getAttribute('aria-label')).toBe('Rename in AutoSync')
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('notes')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      return input
    }

    await rename('  Journal  ')
    await click(button('Save'))
    expect(api.setAlias).toHaveBeenLastCalledWith('notes', 'Journal')
    expect(dialog()).toBeNull()

    const input = await rename('   ')
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(api.setAlias).toHaveBeenLastCalledWith('notes', null)
  })

  it('menu "Copy AI prompt" copies the folder\'s prompt', async () => {
    const folder = makeFolder({ id: 'notes', state: 'attention', attention: { kind: 'no-identity' } })
    const api = await mount(makeStatus([folder]))
    await act(async () => navigate({ folderId: 'notes', copyPrompt: true }))
    expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining(folder.path))
  })
})

describe('theme (D19)', () => {
  it('the Settings sheet shows the current theme and applies a new one at once', async () => {
    const api = await mount(makeStatus([makeFolder({ id: 'notes' })], { theme: 'system' }))
    await act(async () => navigate({ folderId: null, sheet: 'settings' }))
    const radio = (label: string) => [...document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] [role="radio"]')].find((b) => b.textContent === label)!
    expect(radio('System').getAttribute('aria-checked')).toBe('true')
    expect(radio('Dark').getAttribute('aria-checked')).toBe('false')

    await click(radio('Dark') as HTMLButtonElement)

    expect(api.setTheme).toHaveBeenCalledWith('dark')
  })
})
