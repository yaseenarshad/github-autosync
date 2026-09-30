import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import type { AutoSyncApi } from '@shared/api'
import { isGitHubUrl } from '@shared/status'
import type { AppStatus, NavTarget } from '@shared/types'
import { channel, type Invokable } from '../channels'
import { folderMenuTemplate } from './folderMenu'
import { checkFolder } from './git/detect'
import { readActivity } from './git/activity'
import type { SyncManager } from './git/manager'
import { newFolder, withAlias, type Config, type Registry } from './registry'

/**
 * `shared/api.ts`, implemented. Mutations go through the registry, then `apply` hands the new
 * config to the sync manager (which starts or stops folders) and answer the fresh status.
 */

export interface IpcDeps {
  registry: Registry
  manager: SyncManager
  status(): AppStatus
  /** Pushes the registry's config to the manager and the OS (login item). */
  apply(): void
  /** Show the window and take it to `target` — the right-click menu's sheets. */
  navigate(target: NavTarget): void
}

/**
 * `vscode://file/<path>` — the OS decides which VS Code answers, so nothing is spawned. Each segment is percent-encoded with the separators left literal; a Windows
 * path gets forward slashes and keeps its drive (`/C:/Users/…`).
 */
export function vscodeUrl(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, '/').split('/')
  const encoded = segments.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')
  return `vscode://file${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

/**
 * A terminal window already `cd`'d into the folder, spawned without a shell: macOS hands the
 * folder to Terminal.app; Windows asks `start` for a new console (the `""` is its window title,
 * hence verbatim arguments — Node's quoting would mangle it).
 */
export function terminalCommand(platform: NodeJS.Platform, folderPath: string): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/c', 'start', '""', 'cmd.exe', '/K', `cd /d "${folderPath}"`], verbatim: true }
  return { file: '/usr/bin/open', args: ['-a', 'Terminal', folderPath], verbatim: false }
}

/** At most one call per `ms`, always carrying the latest state (trailing edge). */
export function throttle(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    timer ??= setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { registry, manager } = deps
  const folderPath = (id: string): string => {
    const folder = registry.get().folders.find((f) => f.id === id)
    if (folder === undefined) throw new Error(`No folder with id ${id}`)
    return folder.path
  }
  const change = (fn: (config: Config) => Config): AppStatus => {
    registry.update(fn)
    deps.apply()
    return deps.status()
  }

  const api: Pick<AutoSyncApi, Invokable> = {
    getStatus: async () => deps.status(),
    pickFolder: async () => {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },
    checkFolder: (path) => checkFolder(path, registry.get().folders.map((f) => f.path)),
    addFolder: async (path) => change((c) => (c.folders.some((f) => f.path === path) ? c : { ...c, folders: [...c.folders, newFolder(path)] })),
    removeFolder: async (id) => change((c) => ({ ...c, folders: c.folders.filter((f) => f.id !== id) })),
    setFolderEnabled: async (id, enabled) => change((c) => ({ ...c, folders: c.folders.map((f) => (f.id === id ? { ...f, enabled } : f)) })),
    setPaused: async (paused) => change((c) => ({ ...c, paused })),
    syncNow: (id) => manager.syncNow(id),
    resendPullRequest: (id) => manager.resend(id),
    activity: async (id, cursor) => readActivity(folderPath(id), deps.status().hostname, cursor),
    setLaunchAtLogin: async (on) => change((c) => ({ ...c, launchAtLogin: on })),
    setTheme: async (theme) => change((c) => ({ ...c, theme })),
    showInFinder: async (id) => {
      const failure = await shell.openPath(folderPath(id))
      if (failure !== '') throw new Error(failure)
    },
    openExternal: async (url) => {
      if (isGitHubUrl(url)) await shell.openExternal(url)
    },
    copyText: async (text) => clipboard.writeText(text),
    showFolderMenu: async (id) => {
      const status = deps.status()
      const folder = status.folders.find((f) => f.id === id)
      if (folder === undefined) throw new Error(`No folder with id ${id}`)
      // A menu click has no one to report to; a failed open is logged, never an unhandled rejection.
      const quietly = (job: Promise<unknown>) => void job.catch((err: unknown) => console.warn(`[folder-menu] ${String(err)}`))
      const template = folderMenuTemplate(folder, { paused: status.paused, gitMissing: status.gitMissing, platform: process.platform }, {
        navigate: deps.navigate,
        syncNow: () => quietly(manager.syncNow(id)),
        copy: (text) => clipboard.writeText(text),
        viewOnGitHub: (url) => quietly(api.openExternal(url)),
        showInFinder: () => quietly(api.showInFinder(id)),
        openInTerminal: () => quietly(api.openInTerminal(id)),
        openInEditor: () => quietly(api.openInEditor(id)),
        clearAlias: () => quietly(api.setAlias(id, null)),
      })
      // No `window`: the popup goes to the focused window, which is the one that was right-clicked.
      Menu.buildFromTemplate(template).popup()
    },
    setAlias: async (id, alias) => change((c) => ({ ...c, folders: c.folders.map((f) => (f.id === id ? withAlias(f, alias) : f)) })),
    openInTerminal: async (id) => {
      const target = folderPath(id)
      await stat(target) // a moved or deleted folder is an error, not a terminal somewhere else
      const { file, args, verbatim } = terminalCommand(process.platform, target)
      await new Promise<void>((resolve, reject) => {
        execFile(file, args, { windowsVerbatimArguments: verbatim, windowsHide: true }, (err) => (err === null ? resolve() : reject(err)))
      })
    },
    openInEditor: async (id) => {
      const target = folderPath(id)
      await stat(target) // a dead `vscode://` link opens an empty editor rather than failing
      await shell.openExternal(vscodeUrl(target))
    },
  }

  for (const [method, fn] of Object.entries(api) as Array<[Invokable, (...args: unknown[]) => Promise<unknown>]>) {
    ipcMain.handle(channel(method), (_event, ...args: unknown[]) => fn(...args))
  }
}
