import { clipboard, dialog, ipcMain, shell } from 'electron'
import type { AutoSyncApi } from '@shared/api'
import type { AppStatus } from '@shared/types'
import { channel, type Invokable } from '../channels'
import { checkFolder } from './git/detect'
import { readActivity } from './git/activity'
import type { SyncManager } from './git/manager'
import { newFolder, type Config, type Registry } from './registry'

/**
 * `shared/api.ts`, implemented. Mutations go through the registry, then `apply` hands the new
 * config to the sync manager (which starts or stops folders) and answer the fresh status.
 */

export interface IpcDeps {
  registry: Registry
  manager: SyncManager
  hostname: string
  status(): AppStatus
  /** Pushes the registry's config to the manager and the OS (login item). */
  apply(): void
}

/** The one site the app will open in a browser: every link it builds is a GitHub page. */
export const isGithubUrl = (url: string): boolean => url.startsWith('https://github.com/')

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
    activity: async (id, cursor) => readActivity(folderPath(id), deps.hostname, cursor),
    setLaunchAtLogin: async (on) => change((c) => ({ ...c, launchAtLogin: on })),
    showInFinder: async (id) => {
      const failure = await shell.openPath(folderPath(id))
      if (failure !== '') throw new Error(failure)
    },
    openExternal: async (url) => {
      if (isGithubUrl(url)) await shell.openExternal(url)
    },
    copyText: async (text) => clipboard.writeText(text),
  }

  for (const [method, fn] of Object.entries(api) as Array<[Invokable, (...args: unknown[]) => Promise<unknown>]>) {
    ipcMain.handle(channel(method), (_event, ...args: unknown[]) => fn(...args))
  }
}
