import type { MenuItemConstructorOptions } from 'electron'
import { byWorst, clock, headline, lastSyncedAt, plural } from '@shared/status'
import type { AppStatus, FolderStatus, NavTarget, SyncState } from '@shared/types'

/**
 * What the menu bar dot shows (D20) and what its menu says — pure, so both are tested without a
 * tray. `tray.ts` only turns these into pixels and a native menu.
 */

export type TrayState = 'plain' | 'synced' | 'pending' | 'attention' | 'syncing' | 'paused'

/** The one state the dot shows: paused (red, pause bars) beats everything; no folder switched on is the grey ring; else the worst one. */
export function trayState(status: AppStatus): TrayState {
  if (status.paused) return 'paused'
  const [worst] = status.folders
    .map((f) => f.state)
    .filter((s): s is Exclude<SyncState, 'off'> => s !== 'off')
    .sort(byWorst)
  return worst ?? 'plain'
}

function subline(status: AppStatus): string {
  const last = lastSyncedAt(status.folders)
  return `${last === null ? 'Not synced yet' : `Last synced ${clock(last)}`} · ${plural(status.folders.length, 'folder')}`
}

function stateLabel(f: FolderStatus, paused: boolean): string {
  switch (f.state) {
    case 'attention':
      return 'Needs you'
    case 'pending':
      return f.offline ? 'Offline' : 'Waiting'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return 'Synced'
    case 'off':
      return paused ? 'Paused' : 'Off'
  }
}

export interface TrayActions {
  /** Show the window, then take it to `target`. */
  open(target: NavTarget): void
  syncAll(): void
  quit(): void
}

export function trayTemplate(status: AppStatus, actions: TrayActions): MenuItemConstructorOptions[] {
  const header: MenuItemConstructorOptions[] = [{ label: headline(status), enabled: false }]
  if (status.folders.length > 0) header.push({ label: subline(status), enabled: false })
  const rows = [...status.folders]
    .sort((a, b) => byWorst(a.state, b.state))
    .map((f): MenuItemConstructorOptions => ({ label: `● ${f.name} — ${stateLabel(f, status.paused)}`, click: () => actions.open({ folderId: f.id }) }))
  return [
    ...header,
    { type: 'separator' },
    ...(rows.length > 0 ? [...rows, { type: 'separator' as const }] : []),
    { label: 'Sync all now', enabled: !status.paused && status.folders.some((f) => f.enabled), click: () => actions.syncAll() },
    // D15: the renderer confirms; the menu only opens the sheet.
    status.paused
      ? { label: 'Resume syncing…', click: () => actions.open({ folderId: null, sheet: 'resume' }) }
      : { label: 'Pause syncing…', click: () => actions.open({ folderId: null, sheet: 'pause' }) },
    { type: 'separator' },
    { label: 'Open GitHub AutoSync…', click: () => actions.open({ folderId: null }) },
    { label: 'Settings…', click: () => actions.open({ folderId: null, sheet: 'settings' }) },
    { type: 'separator' },
    { label: 'Quit GitHub AutoSync', click: () => actions.quit() },
  ]
}
