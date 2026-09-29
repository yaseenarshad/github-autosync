import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AutoSyncApi } from '@shared/api'
import type { ActivityPage, AppStatus, FolderVerdict, NavTarget } from '@shared/types'
import { App } from './App'
import { platform } from './lib/platform'
import { makeEntry, makeFolder, makeStatus } from '@shared/testFixtures'

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
    pickFolder: vi.fn(async (): Promise<string | null> => null),
    checkFolder: vi.fn(async (): Promise<FolderVerdict> => ({ ok: false, path: '', reason: 'not-git' })),
    addFolder: vi.fn(async () => status),
    removeFolder: vi.fn(async () => status),
    setFolderEnabled: vi.fn(async () => status),
    setPaused: vi.fn(async () => status),
    syncNow: vi.fn(async () => {}),
    resendPullRequest: vi.fn(async () => {}),
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

describe('folder page wording', () => {
  // Fixed clock so the countdowns read exactly.
  const at = new Date(2026, 8, 27, 12).getTime()
  const change = { status: 'M' as const, path: 'a.md' }
  const text = (selector: string) => document.querySelector(selector)?.textContent

  async function show(extra: Parameters<typeof makeFolder>[0]) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at)
    const api = await mount(makeStatus([makeFolder({ id: 'notes', name: 'notes', ...extra })]))
    await click(button('notes'))
    return api
  }

  it('one file too big for GitHub', async () => {
    await show({ tooBig: [{ path: 'video.mov', bytes: 150 * 1024 ** 2 }] })
    expect(text('.card.warn .cb')).toBe(`video.mov is 150 MB. GitHub rejects files over 100 MB, so it stays on ${platform.here} only. Everything else synced.`)
  })

  it('offline, with the retry counting down', async () => {
    await show({ state: 'pending', offline: true, pending: [change], retryAt: at + 90_000 })
    expect(text('.status .s')).toBe("1 change is saved here and will send when you're back online. Retrying in 1:30.")
  })

  it('pending, with the send counting down', async () => {
    await show({ state: 'pending', pending: [change, change], sendAt: at + 23_000 })
    expect(text('.status .s')).toBe('Sends in 0:23 — 30s after you stop editing.')
  })

  it('a pull-request folder counts down to opening its PR (D24)', async () => {
    await show({ state: 'pending', publishVia: 'pr', pending: [change], sendAt: at + 252_000 })
    expect(text('.status .s')).toBe('Opens a PR in 4:12 — 5 minutes after you stop editing.')
    expect(text('.pills')).toContain('Publishes through pull requests')
    expect(text('.tbl .m')).toBe('Waiting — opens a PR 5 minutes after you stop editing')
  })

  it('waiting on an open PR links to it', async () => {
    const url = 'https://github.com/yasin/notes/pull/12'
    const api = await show({ state: 'pending', publishVia: 'pr', pr: { number: 12, url }, pending: [change] })
    expect(text('.status .h')).toBe('Your changes are in a pull request')
    expect(text('.status .s')).toBe("Waiting on PR #12 — synced once it's merged into main.")
    expect(text('.row.sel .sub')).toBe('Waiting on PR #12')
    await click(document.querySelector<HTMLButtonElement>('.status .s .link')!)
    expect(api.openExternal).toHaveBeenCalledWith(url)
  })

  it('push folders do not mention pull requests', async () => {
    await show({})
    expect(container.textContent).not.toContain('pull request')
  })

  it('a closed PR links to it and offers Send again (D25)', async () => {
    const url = 'https://github.com/yasin/notes/pull/7'
    const api = await show({ state: 'attention', publishVia: 'pr', attention: { kind: 'pr-closed', detail: url } })
    expect(text('.card .ct')).toBe('Someone closed the pull request without merging it')
    expect(text('.card .cb')).toBe(
      `Your changes are safe on ${platform.here} — nothing is thrown away. Reopen the PR on GitHub and it will merge and land here, or press Send again to open a fresh one.`,
    )
    await click(button('github.com/yasin/notes/pull/7'))
    expect(api.openExternal).toHaveBeenCalledWith(url)
    await click(button('Send again'))
    expect(api.resendPullRequest).toHaveBeenCalledWith('notes')
    expect(api.syncNow).not.toHaveBeenCalled()
  })

  it('missing GitHub CLI shows gh\'s own words', async () => {
    await show({ state: 'attention', publishVia: 'pr', attention: { kind: 'no-gh', detail: 'You are not logged into any GitHub hosts.' } })
    expect(text('.card .ct')).toBe("The GitHub CLI isn't set up")
    expect(text('.card .prompt')).toBe('You are not logged into any GitHub hosts.')
  })

  it('another app syncing the folder: one card, naming the app (D27)', async () => {
    await show({ state: 'attention', alsoSyncedBy: 'Draw', attention: { kind: 'other-app', detail: 'Draw' } })
    expect([...document.querySelectorAll('.card .ct')].map((c) => c.textContent)).toEqual(['The Draw app also syncs this folder'])
    expect(text('.card .cb')).toBe(
      'One folder, one syncer: AutoSync is standing back and changing nothing until one of them is off. Turn off GitHub sync for this folder in the Draw app, or turn this folder off here.',
    )
  })

  it('a side branch of a pull-request repo', async () => {
    await show({ state: 'attention', publishVia: 'pr', branch: 'yasin/draft', attention: { kind: 'busy-repo', detail: 'side-branch' } })
    expect(text('.card .ct')).toBe('On a side branch — switch back to the main branch to sync')
    expect(text('.row.sel .sub')).toBe('On a side branch')
  })
})

describe('add folder (D12)', () => {
  const inSheet = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes(label))!
  const verdictText = () => document.querySelector('.verdict')?.textContent

  async function pick(verdict: FolderVerdict) {
    const api = await mount(oneFolder)
    api.pickFolder.mockResolvedValue(verdict.path)
    api.checkFolder.mockResolvedValue(verdict)
    await click(button('Add folder'))
    return api
  }

  const path = '/Users/yasin/Documents/GitHub/new-repo'
  it.each<[string, FolderVerdict, string]>([
    ['already added', { ok: false, path, reason: 'already-added' }, 'Already added.'],
    ['not git', { ok: false, path, reason: 'not-git' }, 'Not a git folder. AutoSync only syncs folders that are already git repositories.'],
    ['no origin', { ok: false, path, reason: 'no-origin' }, 'This is a git folder but it has no GitHub remote (“origin”), so there\'s nowhere to sync to.'],
    ['auth', { ok: false, path, reason: 'auth' }, `It's a one-time fix: run “gh auth login” in ${platform.terminal}, then try again.`],
    ['no git', { ok: false, path, reason: 'no-git' }, "Git isn't installed on this computer, so AutoSync can't sync anything yet."],
  ])('%s: says why, and Add stays off', async (_, verdict, words) => {
    const api = await pick(verdict)
    expect(verdictText()).toContain(words)
    expect(inSheet('Add folder').disabled).toBe(true)
    await click(inSheet('Add folder'))
    expect(api.addFolder).not.toHaveBeenCalled()
  })

  it('a folder another app syncs, while offline: warns, and adds on click', async () => {
    const api = await pick({ ok: true, path, warning: 'Draw', offline: true })
    expect(verdictText()).toBe(
      "The Draw app also syncs this folder. You can still add it, but AutoSync will wait until GitHub sync is turned off for this folder in Draw — one folder, one syncer. Couldn't reach GitHub right now — it will retry.",
    )
    api.addFolder.mockResolvedValue(makeStatus([makeFolder({ id: 'new', path })]))
    await click(inSheet('Add folder'))
    expect(api.addFolder).toHaveBeenCalledWith(path)
    expect(dialog()).toBeNull()
  })

  it('inside a repo: offers the top of it, and "Use" checks that folder again', async () => {
    const root = '/Users/yasin/Documents/GitHub/notes'
    const api = await pick({ ok: false, path: `${root}/client`, reason: 'not-root', root })
    expect(verdictText()).toContain('This is inside a git folder, not the top of one. Pick ~/Documents/GitHub/notes instead.')

    api.checkFolder.mockResolvedValue({ ok: true, path: root, warning: null, offline: false })
    await click(inSheet('Use ~/Documents/GitHub/notes'))

    expect(api.checkFolder).toHaveBeenLastCalledWith(root)
    expect(verdictText()).toBe('Git folder with a GitHub remote. Ready to sync.')
    expect(inSheet('Add folder').disabled).toBe(false)
  })
})
