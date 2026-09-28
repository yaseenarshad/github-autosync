import type { MenuItemConstructorOptions } from 'electron'
import type { FolderStatus, NavTarget } from '@shared/types'

/**
 * D18: the native right-click menu for one folder — pure, so every item and when it shows is
 * tested without a menu. Anything that needs a confirmation or a text field (turn off, remove,
 * rename) opens a sheet in the window; the renderer owns those, and the AI prompt texts too.
 */

export interface FolderMenuActions {
  navigate(target: NavTarget): void
  syncNow(): void
  copy(text: string): void
  viewOnGitHub(url: string): void
  showInFinder(): void
  openInTerminal(): void
  openInEditor(): void
  clearAlias(): void
}

export interface FolderMenuContext {
  paused: boolean
  gitMissing: boolean
  platform: NodeJS.Platform
}

type Item = MenuItemConstructorOptions

export function folderMenuTemplate(folder: FolderStatus, ctx: FolderMenuContext, actions: FolderMenuActions): Item[] {
  const win = ctx.platform === 'win32'
  const open = (target: Omit<NavTarget, 'folderId'>) => () => actions.navigate({ folderId: folder.id, ...target })
  const web = folder.webUrl
  const groups: Array<Array<Item | null>> = [
    [
      { label: 'Sync now', enabled: !ctx.paused && !ctx.gitMissing && folder.state !== 'off', click: () => actions.syncNow() },
      folder.enabled ? { label: 'Turn off syncing…', click: open({ sheet: 'folder-off' }) } : { label: 'Turn on syncing…', click: open({ sheet: 'folder-on' }) },
    ],
    [
      { label: 'Copy folder name', click: () => actions.copy(folder.name) },
      { label: 'Copy path', click: () => actions.copy(folder.path) },
      web === null ? null : { label: 'Copy GitHub URL', click: () => actions.copy(web) },
      folder.attention === null ? null : { label: 'Copy AI prompt', click: open({ copyPrompt: true }) },
    ],
    [
      web === null ? null : { label: 'View on GitHub', click: () => actions.viewOnGitHub(web) },
      { label: win ? 'Show in File Explorer' : 'Show in Finder', click: () => actions.showInFinder() },
      { label: win ? 'Open in Command Prompt' : 'Open in Terminal', click: () => actions.openInTerminal() },
      { label: 'Open in VS Code', click: () => actions.openInEditor() },
    ],
    [
      { label: 'Rename in AutoSync…', click: open({ sheet: 'rename' }) },
      folder.alias === null ? null : { label: 'Remove nickname', click: () => actions.clearAlias() },
    ],
    [{ label: 'Remove…', click: open({ sheet: 'remove' }) }],
  ]
  return groups.flatMap((group, i) => [...(i === 0 ? [] : [{ type: 'separator' as const }]), ...group.filter((item): item is Item => item !== null)])
}
