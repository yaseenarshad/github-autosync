import type { MenuItemConstructorOptions } from 'electron'
import type { AppStatus, FolderStatus, NavTarget, SyncState } from '@shared/types'

/**
 * What the menu bar octopus shows and what its menu says — pure, so both are tested without a
 * tray. `tray.ts` only turns these into pixels and a native menu.
 */

export type TrayState = 'plain' | 'synced' | 'pending' | 'attention' | 'syncing' | 'paused'

/** Worst first: what needs the user outranks what is waiting, which outranks what is moving. */
const SEVERITY: Record<SyncState, number> = { attention: 0, pending: 1, syncing: 2, synced: 3, off: 4 }

/** The one state the icon shows: paused says paused; no enabled folder shows the bare octopus; else the worst enabled folder. */
export function trayState(status: AppStatus): TrayState {
  if (status.paused) return 'paused'
  const states = status.folders.filter((f) => f.enabled).map((f) => f.state)
  if (states.length === 0) return 'plain'
  const worst = states.reduce((a, b) => (SEVERITY[b] < SEVERITY[a] ? b : a))
  return worst === 'off' ? 'plain' : worst
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function headline(status: AppStatus): string {
  if (status.paused) return 'Paused'
  const count = (state: SyncState) => status.folders.filter((f) => f.enabled && f.state === state).length
  if (count('attention') > 0) return `${plural(count('attention'), 'folder needs', 'folders need')} you`
  if (count('pending') > 0) return `${count('pending')} waiting`
  if (count('syncing') > 0) return 'Syncing…'
  if (status.folders.length === 0) return 'No folders yet'
  if (!status.folders.some((f) => f.enabled)) return 'No folders syncing'
  return 'All synced'
}

/** `3:05 PM` — the menu is a glance, not a log. */
export const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function subline(status: AppStatus): string {
  const last = Math.max(0, ...status.folders.map((f) => f.lastSyncedAt ?? 0))
  const when = last === 0 ? 'Not synced yet' : `Last synced ${clockTime(last)}`
  return `${when} · ${plural(status.folders.length, 'folder', 'folders')}`
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
    .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])
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
