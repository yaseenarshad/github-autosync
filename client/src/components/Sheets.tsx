import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppStatus, FolderStatus, FolderVerdict, OtherRepo, ThemeChoice } from '@shared/types'
import { CHECKS_EVERY, pullLabel, pushLabel, SENDS_AFTER } from '@shared/status'
import { AddFolderSheet } from './AddFolderSheet'
import { FolderPickerSheet } from './FolderPicker'
import { platform } from '../lib/platform'

export type SheetState =
  | { kind: 'settings' }
  | { kind: 'add'; verdict: FolderVerdict }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'folder-off'; id: string }
  | { kind: 'folder-on'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'rename'; id: string }
  | { kind: 'pick-folders'; id: string }
  | { kind: 'push-outside'; id: string }
  | { kind: 'add-other'; key: string }
  | { kind: 'clone-other'; key: string }
  | { kind: 'hide-other'; key: string }

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}

export function Sheet({ title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          {title}
          <button className="x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sb">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}

/** D15: every on/off change asks first. Cancel holds focus so Enter never does the risky thing. */
function ConfirmSheet({ title, confirm, danger, onConfirm, onClose, children }: ConfirmProps) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'red' : 'blue'}`}
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      {children}
    </Sheet>
  )
}

const THEMES: ReadonlyArray<[ThemeChoice, string]> = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

function SettingsSheet({ status, onClose }: { status: AppStatus; onClose: () => void }) {
  return (
    <Sheet
      title="Settings"
      onClose={onClose}
      footer={
        <button className="btn blue" onClick={onClose}>
          Done
        </button>
      }
    >
      <Setting title="Open at login" detail={`Starts quietly in the ${platform.bar} when you log in. The window stays closed.`}>
        <button
          className={`switch ${status.launchAtLogin ? 'on' : ''}`}
          role="switch"
          aria-checked={status.launchAtLogin}
          aria-label="Open at login"
          onClick={() => window.autosync.setLaunchAtLogin(!status.launchAtLogin)}
        >
          <span className="track" />
        </button>
      </Setting>
      <Setting title="Theme" detail="System follows your computer's light or dark setting.">
        <div className="seg" role="radiogroup" aria-label="Theme">
          {THEMES.map(([value, label]) => (
            <button key={value} role="radio" aria-checked={status.theme === value} className={status.theme === value ? 'on' : ''} onClick={() => window.autosync.setTheme(value)}>
              {label}
            </button>
          ))}
        </div>
      </Setting>
      <Setting
        title="This computer's name"
        detail={`Shown in commit messages and conflict copies so you know which ${platform.machine} changed what.`}
      >
        <span className="mono">{status.hostname}</span>
      </Setting>
      <SettingsFolderRow status={status} />
      {status.others.some((o) => o.hidden) && (
        <Setting title="Hidden repos" detail={`${status.others.filter((o) => o.hidden).map((o) => o.name).join(', ')}: synced on your other computers, hidden here.`}>
          <button className="btn" onClick={() => window.autosync.hideOther(null)}>
            Show hidden repos
          </button>
        </Setting>
      )}
      <Setting title="When it syncs" detail={`By default: sends ${SENDS_AFTER} · checks GitHub ${CHECKS_EVERY} · on wake · when you quit. Each folder can change this.`} />
      <Setting title="Notifications" detail="Only when a folder needs you, or changes haven't sent for an hour. Never on success." />
    </Sheet>
  )
}

/** D35: where the settings travel. Each computer writes only its own file there. */
function SettingsFolderRow({ status }: { status: AppStatus }) {
  const api = window.autosync
  const detail = status.settingsFolder === null
    ? `Not set: each folder's settings stay on ${platform.here}. Pick a folder that git syncs to share them with your other computers.`
    : status.settingsFolderMissing
      ? `Can't find ${status.settingsFolder}. AutoSync keeps its own copy until it's back.`
      : `${status.settingsFolder} · each computer writes its own file here`
  async function choose() {
    const picked = await api.pickSettingsFolder()
    if (picked !== null) await api.setSettingsFolder(picked)
  }
  return (
    <Setting title="Settings folder" detail={detail} warn={status.settingsFolderMissing}>
      <div className="acts">
        <button className="btn" onClick={choose}>
          Choose…
        </button>
        {status.settingsFolder !== null && (
          <button className="btn" onClick={() => api.setSettingsFolder(null)}>
            Stop sharing
          </button>
        )}
      </div>
    </Setting>
  )
}

function Setting({ title, detail, children, warn }: { title: string; detail: string; children?: ReactNode; warn?: boolean }) {
  return (
    <div className="set">
      <div className="grow">
        <div className="t">{title}</div>
        <div className={`d${warn ? ' warn' : ''}`}>{detail}</div>
      </div>
      {children}
    </div>
  )
}

interface AppSheetProps {
  sheet: SheetState
  status: AppStatus
  home: string | null
  onClose: () => void
  onSelect: (id: string | null) => void
  /** D53: an Add whose checks failed shows the Add sheet with the reason. */
  onAddFailed: (verdict: FolderVerdict) => void
}

export function AppSheet({ sheet, status, home, onClose, onSelect, onAddFailed }: AppSheetProps) {
  const api = window.autosync

  switch (sheet.kind) {
    case 'settings':
      return <SettingsSheet status={status} onClose={onClose} />
    case 'add':
      return <AddFolderSheet initial={sheet.verdict} home={home} onClose={onClose} onAdded={onSelect} />
    case 'pause':
      return (
        <ConfirmSheet
          title="Pause syncing for all folders?"
          confirm={`Pause all ${status.folders.filter((f) => f.enabled).length} folders`}
          danger
          onConfirm={() => api.setPaused(true)}
          onClose={onClose}
        >
          <p className="first">
            Nothing will be committed, pulled, or pushed until you resume. Your edits stay safe on {platform.here}, but{' '}
            <b>your other computers won't get them</b> — and you won't get theirs.
          </p>
          <p className="muted last">The {platform.bar} icon switches to ⏸ while paused, so you won't forget.</p>
        </ConfirmSheet>
      )
    case 'resume':
      return (
        <ConfirmSheet
          title="Resume syncing for all folders?"
          confirm="Resume syncing"
          onConfirm={() => api.setPaused(false)}
          onClose={onClose}
        >
          <p className="first last">
            AutoSync will catch up right away: send what's waiting on {platform.here} and pull what changed on your other computers.
          </p>
        </ConfirmSheet>
      )
  }

  if (sheet.kind === 'add-other' || sheet.kind === 'clone-other' || sheet.kind === 'hide-other') {
    // A status push can drop the repo (added elsewhere, or no longer synced) while its sheet is open.
    const other = status.others.find((o) => o.key === sheet.key)
    if (!other) return null
    return <OtherSheet kind={sheet.kind} other={other} onClose={onClose} onAddFailed={onAddFailed} />
  }

  // A status push can remove the folder while its sheet is open.
  const folder = status.folders.find((f) => f.id === sheet.id)
  if (!folder) return null

  switch (sheet.kind) {
    case 'folder-off':
      return (
        <ConfirmSheet
          title={`Turn off syncing for “${folder.name}”?`}
          confirm="Turn off syncing"
          danger
          onConfirm={() => api.setFolderEnabled(folder.id, false)}
          onClose={onClose}
        >
          <p className="first">
            This folder will stop syncing <b>on {platform.here} only</b>. Edits here won't reach your other computers, and theirs won't
            arrive here, until you turn it back on.
          </p>
          <p className="muted last">Nothing is deleted. It stays in your folder list with a grey dot.</p>
        </ConfirmSheet>
      )
    case 'folder-on':
      return (
        <ConfirmSheet
          title={`Turn syncing back on for “${folder.name}”?`}
          confirm="Turn on syncing"
          onConfirm={() => api.setFolderEnabled(folder.id, true)}
          onClose={onClose}
        >
          <p className="first last">
            AutoSync will commit anything that changed while it was off, pull from your other computers, and push. If the same file changed
            in both places, both versions are kept.
          </p>
        </ConfirmSheet>
      )
    case 'remove':
      return (
        <ConfirmSheet
          title={`Remove “${folder.name}”?`}
          confirm="Remove"
          onConfirm={async () => {
            await api.removeFolder(folder.id)
            onSelect(null)
          }}
          onClose={onClose}
        >
          AutoSync will stop syncing this folder on {platform.here}. <b>Nothing is deleted</b> — the files stay on {platform.yours} and on
          GitHub. Your other computers keep syncing it until you remove it there too.
        </ConfirmSheet>
      )
    case 'rename':
      return <RenameSheet folder={folder} onClose={onClose} />
    case 'pick-folders':
      return <FolderPickerSheet folder={folder} onClose={onClose} />
    case 'push-outside':
      return (
        <ConfirmSheet title={`Push ${folder.outside.length === 1 ? 'this file' : `these ${folder.outside.length} files`} now?`} confirm="Push now" onConfirm={() => api.pushOutside(folder.id)} onClose={onClose}>
          <p className="first">
            They are outside the folders “{folder.name}” syncs. AutoSync sends them once, with everything else that waits, and then goes back to your
            folders only.
          </p>
          <ul className="files">
            {folder.outside.map((c) => (
              <li key={c.path}>{c.path}</li>
            ))}
          </ul>
        </ConfirmSheet>
      )
  }
}

/** D53, D54: Add, Clone… and hide each say what will happen before anything does (D15). */
function OtherSheet({ kind, other: o, onClose, onAddFailed }: { kind: 'add-other' | 'clone-other' | 'hide-other'; other: OtherRepo; onClose: () => void; onAddFailed: (verdict: FolderVerdict) => void }) {
  const api = window.autosync
  const from = o.computers.join(', ')
  const settings = (
    <ul className="files">
      <li>Push: {pushLabel(o.settings.push)}</li>
      <li>Pull: {pullLabel(o.settings.pull)}</li>
      <li>Folders: {o.settings.paths === null ? 'the whole repo' : o.settings.paths.join(', ')}</li>
      {o.settings.beforePush !== null && <li>Before each push: {o.settings.beforePush}</li>}
    </ul>
  )
  switch (kind) {
    case 'add-other':
      return (
        <ConfirmSheet
          title={`Start syncing “${o.name}” on ${platform.here}?`}
          confirm="Start syncing"
          onConfirm={async () => {
            const verdict = await api.addOther(o.key)
            if (!verdict.ok) onAddFailed(verdict)
          }}
          onClose={onClose}
        >
          <p className="first">
            {from} syncs this repo. AutoSync found a copy here: <span className="mono">{o.found}</span>. It will pull what changed, then sync with the same
            settings as {from}:
          </p>
          {settings}
          <p className="muted last">You can change them later under Sync settings. They change on every computer.</p>
        </ConfirmSheet>
      )
    case 'clone-other':
      return (
        <ConfirmSheet title={`Download “${o.name}” to ${platform.here}?`} confirm="Choose a folder…" onConfirm={() => api.cloneOther(o.key)} onClose={onClose}>
          <p className="first">
            {from} syncs this repo, and {platform.here} has no copy yet. AutoSync downloads it from <span className="mono">{o.remoteUrl}</span> into a folder you
            pick, then syncs it with these settings:
          </p>
          {settings}
          <p className="muted last">A big repo can take a few minutes. Nothing is changed on {from} or on GitHub.</p>
        </ConfirmSheet>
      )
    case 'hide-other':
      return (
        <ConfirmSheet title={`Hide “${o.name}” on ${platform.here}?`} confirm="Hide" onConfirm={() => api.hideOther(o.key)} onClose={onClose}>
          <p className="first last">
            It stays synced on {from}. It just won't show here. Settings → Show hidden repos brings it back.
          </p>
        </ConfirmSheet>
      )
  }
}

/** D18: a nickname shown in AutoSync only. */
function RenameSheet({ folder, onClose }: { folder: FolderStatus; onClose: () => void }) {
  const [value, setValue] = useState(folder.alias ?? folder.name)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.select(), [])

  async function save() {
    await window.autosync.setAlias(folder.id, value.trim() || null)
    onClose()
  }

  return (
    <Sheet
      title="Rename in AutoSync"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn blue" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="first">Only changes how the folder is shown here. Nothing on disk or GitHub is renamed.</p>
      <input
        ref={input}
        className="text-input"
        aria-label="Name in AutoSync"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </Sheet>
  )
}
