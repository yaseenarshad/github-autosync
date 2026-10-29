import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import type { AutoSyncApi } from '@shared/api'
import { isGitHubUrl, MINUTE_MS } from '@shared/status'
import type { AppStatus, NavTarget, OtherRepo } from '@shared/types'
import { channel, type Invokable } from '../channels'
import { folderMenuTemplate } from './folderMenu'
import { checkFolder, listSubfolders } from './git/detect'
import { findGit } from './git/exec'
import { readActivity } from './git/activity'
import type { SyncManager } from './git/manager'
import { cloneInto } from './others'
import { isRepoPath, newFolder, withAlias, withRepoSettings, type Config, type Registry } from './registry'

/**
 * `shared/api.ts`, implemented. Mutations go through the registry, then `apply` hands the new
 * config to the sync manager (which starts or stops folders) and answer the fresh status.
 */

/** D53, D54: the other computers' repos, as `index.ts` keeps them. */
export interface OthersDeps {
  find(key: string): OtherRepo | undefined
  /** A clone started or failed; null forgets it (done). */
  mark(key: string, state: { cloning: boolean; error: string | null } | null): void
  /** Look for clones again (a folder was added). */
  refresh(): void
}

export interface IpcDeps {
  registry: Registry
  manager: SyncManager
  others: OthersDeps
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
    setRepoSettings: async (id, settings) => {
      const repo = deps.status().folders.find((f) => f.id === id)?.repo ?? null
      if (repo === null) throw new Error(`The origin of folder ${id} is not known yet`)
      return change((c) => withRepoSettings(c, repo, settings))
    },
    pickSettingsFolder: async () => {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], message: 'Choose a folder that git syncs to every computer' })
      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },
    setSettingsFolder: async (path) => change((c) => ({ ...c, settingsFolder: path })),
    listFolders: async (id, rel) => {
      if (rel !== '' && !isRepoPath(rel)) throw new Error(`Not a folder in the repo: ${rel}`)
      const bin = await findGit()
      if (bin === null) throw new Error('git not found')
      return listSubfolders(bin, folderPath(id), rel)
    },
    pushOutside: (id) => manager.pushOutside(id),
    addOther: async (key) => {
      const other = deps.others.find(key)
      if (other?.found == null) throw new Error(`No clone of ${key} on this computer`)
      const at = other.found
      // D53: the same checks as Add folder (D12); a failed one adds nothing and the window shows why.
      const verdict = await checkFolder(at, registry.get().folders.map((f) => f.path))
      if (verdict.ok) {
        change((c) => ({ ...c, folders: [...c.folders, newFolder(at, other.remoteUrl)] }))
        deps.others.refresh()
      }
      return verdict
    },
    cloneOther: async (key) => {
      const other = deps.others.find(key)
      if (other === undefined) throw new Error(`No repo ${key} on the other computers`)
      const near = path.dirname(other.expectedPath)
      const picked = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        ...(existsSync(near) ? { defaultPath: near } : {}),
        message: `Choose the folder to put ${other.name} in`,
      })
      const parent = picked.canceled ? null : (picked.filePaths[0] ?? null)
      if (parent === null) return
      deps.others.mark(key, { cloning: true, error: null })
      const cloned = await cloneInto(other.remoteUrl, parent, other.name)
      deps.others.mark(key, cloned.ok ? null : { cloning: false, error: cloned.error })
      if (cloned.ok) {
        change((c) => ({ ...c, folders: [...c.folders, newFolder(cloned.path, other.remoteUrl)] }))
        deps.others.refresh()
      }
    },
    setDefaults: async (defaults) => change((c) => ({ ...c, defaults })),
    hideOther: async (key) => change((c) => ({ ...c, hiddenRepos: key === null ? [] : [...new Set([...c.hiddenRepos, key])] })),
    pauseFolder: async (id, minutes) =>
      change((c) => ({
        ...c,
        folders: c.folders.map((f) => {
          if (f.id !== id) return f
          const { pausedUntil: _old, ...rest } = f
          return minutes === null ? rest : { ...rest, pausedUntil: Date.now() + minutes * MINUTE_MS }
        }),
      })),
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
        pause: (minutes) => quietly(api.pauseFolder(id, minutes)),
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
