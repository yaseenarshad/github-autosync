import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { channel } from '../channels'
import type { SyncManager } from './git/manager'
import { registerIpc, terminalCommand, throttle, vscodeUrl, type IpcDeps } from './ipc'

// Only the handler table is under test; nothing here opens a dialog or a window.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, clipboard: {}, dialog: {}, Menu: {}, shell: {} }))

describe('throttle', () => {
  it('collapses a burst into one trailing call, then allows the next one', async () => {
    let calls = 0
    const fire = throttle(() => {
      calls += 1
    }, 20)
    for (let i = 0; i < 10; i += 1) fire()
    expect(calls).toBe(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(1)
    fire()
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(2)
  })
})

describe('vscodeUrl', () => {
  it('encodes each path segment and keeps the separators', () => {
    expect(vscodeUrl('/Users/me/My Notes/#1')).toBe('vscode://file/Users/me/My%20Notes/%231')
  })

  it('turns a Windows path into forward slashes, drive letter intact', () => {
    expect(vscodeUrl('C:\\Users\\me\\My Notes')).toBe('vscode://file/C:/Users/me/My%20Notes')
  })
})

describe('terminalCommand', () => {
  it('hands the folder to Terminal.app on a Mac, no shell', () => {
    expect(terminalCommand('darwin', '/Users/me/My Notes')).toEqual({ file: '/usr/bin/open', args: ['-a', 'Terminal', '/Users/me/My Notes'], verbatim: false })
  })

  it('opens a new console already in the folder on Windows', () => {
    expect(terminalCommand('win32', 'C:\\My Notes')).toEqual({ file: 'cmd.exe', args: ['/c', 'start', '""', 'cmd.exe', '/K', 'cd /d "C:\\My Notes"'], verbatim: true })
  })
})

describe('registerIpc', () => {
  it('routes resendPullRequest to the manager (D25)', async () => {
    const resend = vi.fn(async (_id: string) => undefined)
    const deps = { manager: { resend } as unknown as SyncManager } as IpcDeps
    registerIpc(deps)
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel('resendPullRequest'))?.[1]
    await handler?.({} as Electron.IpcMainInvokeEvent, 'notes')
    expect(resend).toHaveBeenCalledWith('notes')
  })
})
