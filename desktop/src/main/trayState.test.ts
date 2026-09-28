import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { NavTarget, SyncState } from '@shared/types'
import { makeFolder, makeStatus } from '@shared/testFixtures'
import { clock } from '@shared/status'
import { trayState, trayTemplate, trayVariant } from './trayState'

const f = (id: string, state: SyncState, extra = {}) => makeFolder({ id, name: id, state, ...extra })

describe('trayState (worst enabled folder wins)', () => {
  it.each<[SyncState[], string]>([
    [[], 'plain'],
    [['synced', 'synced'], 'synced'],
    [['synced', 'syncing'], 'syncing'],
    [['syncing', 'pending'], 'pending'],
    [['pending', 'attention', 'synced'], 'attention'],
  ])('%j → %s', (states, expected) => {
    expect(trayState(makeStatus(states.map((s, i) => f(`f${i}`, s))))).toBe(expected)
  })

  it('ignores disabled folders, shows the bare octopus when none is enabled, and paused beats everything', () => {
    expect(trayState(makeStatus([f('a', 'synced'), f('b', 'off', { enabled: false, attention: { kind: 'auth' } })]))).toBe('synced')
    expect(trayState(makeStatus([f('b', 'off', { enabled: false })]))).toBe('plain')
    expect(trayState(makeStatus([f('a', 'off')], { paused: true }))).toBe('paused')
  })
})

describe('trayTemplate', () => {
  const actions = () => ({ open: vi.fn<(t: NavTarget) => void>(), syncAll: vi.fn(), quit: vi.fn() })
  const labels = (items: MenuItemConstructorOptions[]) => items.map((i) => (i.type === 'separator' ? '---' : i.label))

  // The headline's wording is shared/status.ts (status.test.ts); this pins where it goes.
  it('heads with the worst news and the last sync, then folders attention-first', () => {
    const at = new Date(2026, 8, 27, 15, 5).getTime()
    const status = makeStatus([f('Alpha', 'synced', { lastSyncedAt: at - 60_000 }), f('Beta', 'attention', { lastSyncedAt: at }), f('Gamma', 'pending', { offline: true })])
    expect(labels(trayTemplate(status, actions()))).toEqual([
      '1 folder needs you',
      `Last synced ${clock(at)} · 3 folders`,
      '---',
      '● Beta — Needs you',
      '● Gamma — Offline',
      '● Alpha — Synced',
      '---',
      'Sync all now',
      'Pause syncing…',
      '---',
      'Open GitHub AutoSync…',
      'Settings…',
      '---',
      'Quit GitHub AutoSync',
    ])
    expect(clock(at)).toBe('3:05 PM')
  })

  it('wires every click to the right target; pause and resume go through the window (D15)', () => {
    const a = actions()
    const click = (items: MenuItemConstructorOptions[], label: string) => (items.find((i) => i.label === label)?.click as () => void)()
    const items = trayTemplate(makeStatus([f('Alpha', 'synced')]), a)
    click(items, '● Alpha — Synced')
    click(items, 'Pause syncing…')
    click(items, 'Open GitHub AutoSync…')
    click(items, 'Settings…')
    click(items, 'Sync all now')
    click(items, 'Quit GitHub AutoSync')
    click(trayTemplate(makeStatus([f('Alpha', 'off')], { paused: true }), a), 'Resume syncing…')
    expect(a.open.mock.calls.map(([t]) => t)).toEqual([
      { folderId: 'Alpha' },
      { folderId: null, sheet: 'pause' },
      { folderId: null },
      { folderId: null, sheet: 'settings' },
      { folderId: null, sheet: 'resume' },
    ])
    expect(a.syncAll).toHaveBeenCalledOnce()
    expect(a.quit).toHaveBeenCalledOnce()
  })

  it('shows off folders as paused while paused, and disables Sync all now', () => {
    const items = trayTemplate(makeStatus([f('Alpha', 'off')], { paused: true }), actions())
    expect(labels(items)).toContain('● Alpha — Paused')
    expect(items.find((i) => i.label === 'Sync all now')?.enabled).toBe(false)
  })
})

describe('trayVariant (D19: the OS appearance, never the app theme)', () => {
  it('on a Mac follows AppleInterfaceStyle alone', () => {
    expect(trayVariant('darwin', { appleInterfaceStyle: 'Dark', systemUiDark: false })).toBe('dark')
    expect(trayVariant('darwin', { appleInterfaceStyle: '', systemUiDark: true })).toBe('light')
  })

  it('on Windows follows the taskbar', () => {
    expect(trayVariant('win32', { appleInterfaceStyle: '', systemUiDark: true })).toBe('dark')
    expect(trayVariant('win32', { appleInterfaceStyle: '', systemUiDark: false })).toBe('light')
  })
})
