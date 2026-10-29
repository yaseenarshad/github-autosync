import type { ReactNode } from 'react'
import type { AppStatus, FolderStatus, PullEvery, PushEvery, RepoSettings } from '@shared/types'
import { PULL_CHOICES, pullLabel, PUSH_CHOICES, pushLabel } from '@shared/status'
import { platform } from '../lib/platform'

/** `<select>` values are strings: minutes as digits, the rest as their words. */
const encode = (v: PushEvery | PullEvery): string => String(v)
const decodePush = (v: string): PushEvery => (v === 'auto' || v === 'manual' ? v : Number(v))
const decodePull = (v: string): PullEvery => (v === 'manual' ? v : Number(v))

/** D34: one folder's repo settings. They apply on every computer once a settings folder is set (D35). */
export function SyncSettings({ folder: f, status }: { folder: FolderStatus; status: AppStatus }) {
  const known = f.repo !== null
  const save = (change: Partial<RepoSettings>) => window.autosync.setRepoSettings(f.id, { ...f.settings, ...change })
  const where = !known
    ? 'Available after the first sync, once AutoSync knows which repo this is.'
    : status.settingsFolder === null
      ? `Saved on ${platform.here} only. Choose a settings folder in Settings to use them on every computer.`
      : 'The same on every computer that syncs this repo.'

  return (
    <div className="section">
      <h2>Sync settings</h2>
      <div className="actions">
        <Row title="Push" detail={where}>
          <select className="select" aria-label="Push" disabled={!known} value={encode(f.settings.push)} onChange={(e) => save({ push: decodePush(e.target.value) })}>
            {PUSH_CHOICES.map((p) => (
              <option key={encode(p)} value={encode(p)}>
                {pushLabel(p)}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Pull" detail="Brings in what your other computers sent. Pulls never push.">
          <select className="select" aria-label="Pull" disabled={!known} value={encode(f.settings.pull)} onChange={(e) => save({ pull: decodePull(e.target.value) })}>
            {PULL_CHOICES.map((p) => (
              <option key={encode(p)} value={encode(p)}>
                {pullLabel(p)}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </div>
  )
}

function Row({ title, detail, children }: { title: string; detail: ReactNode; children: ReactNode }) {
  return (
    <div className="action">
      <div className="grow">
        <div className="t">{title}</div>
        <div className="d">{detail}</div>
      </div>
      {children}
    </div>
  )
}
