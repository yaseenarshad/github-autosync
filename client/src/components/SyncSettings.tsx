import { useEffect, useState, type ReactNode } from 'react'
import type { AppStatus, FolderStatus, PullEvery, PushEvery, RepoSettings } from '@shared/types'
import { PULL_CHOICES, pullLabel, PUSH_CHOICES, pushLabel } from '@shared/status'
import { platform } from '../lib/platform'
import { Icon } from './Icon'
import type { SheetState } from './Sheets'

/** `<select>` values are strings: minutes as digits, the rest as their words. */
const encode = (v: PushEvery | PullEvery): string => String(v)
const decodePush = (v: string): PushEvery => (v === 'auto' || v === 'manual' ? v : Number(v))
const decodePull = (v: string): PullEvery => (v === 'manual' ? v : Number(v))

/** D34: one folder's repo settings, one line each; the explanations sit behind ⓘ. They apply on every computer once a settings folder is set (D35). */
export function SyncSettings({ folder: f, status, onSheet }: { folder: FolderStatus; status: AppStatus; onSheet: (sheet: SheetState) => void }) {
  const known = f.repo !== null
  const save = (change: Partial<RepoSettings>) => window.autosync.setRepoSettings(f.id, { ...f.settings, ...change })
  const where = !known
    ? 'Available after the first sync, once AutoSync knows which repo this is.'
    : status.settingsFolder === null
      ? `Saved on ${platform.here} only. Choose a settings folder in Settings to use them on every computer.`
      : 'The same on every computer that syncs this repo.'

  return (
    <div className="section">
      <h2>
        Sync settings <Info text={where} />
      </h2>
      <div className="kv">
        <div className="kv-row two">
          <Field label="Push" info="When your changes go to GitHub. Auto: 30s after you stop editing. A time: once, that long after your first change.">
            <select className="select" aria-label="Push" disabled={!known} value={encode(f.settings.push)} onChange={(e) => save({ push: decodePush(e.target.value) })}>
              {PUSH_CHOICES.map((p) => (
                <option key={encode(p)} value={encode(p)}>
                  {pushLabel(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pull" info="How often it brings in what your other computers sent. Pulls never push.">
            <select className="select" aria-label="Pull" disabled={!known} value={encode(f.settings.pull)} onChange={(e) => save({ pull: decodePull(e.target.value) })}>
              {PULL_CHOICES.map((p) => (
                <option key={encode(p)} value={encode(p)}>
                  {pullLabel(p)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="kv-row">
          <Field label="Folders" info="Only these folders are committed and pushed. Pulls still bring in the whole repo.">
            <div className="chips">
              {f.settings.paths === null ? <span className="chip">Whole repo</span> : f.settings.paths.map((p) => <span className="chip mono" key={p}>{p}</span>)}
              <button className="link" disabled={!known} onClick={() => onSheet({ kind: 'pick-folders', id: f.id })}>
                Choose folders…
              </button>
            </div>
          </Field>
        </div>
        <BeforePush folder={f} known={known} save={save} />
      </div>
    </div>
  )
}

/** D49: one command, run in the repo root before each push. Saved with Enter or Save; Clear removes it. */
function BeforePush({ folder: f, known, save }: { folder: FolderStatus; known: boolean; save: (change: Partial<RepoSettings>) => Promise<unknown> }) {
  const [draft, setDraft] = useState(f.settings.beforePush ?? '')
  useEffect(() => setDraft(f.settings.beforePush ?? ''), [f.settings.beforePush])
  const changed = draft.trim() !== (f.settings.beforePush ?? '')
  const commit = () => save({ beforePush: draft.trim() === '' ? null : draft.trim() })
  return (
    <div className="kv-row">
      <Field label="Before push" info="A command run in the repo folder before each push, for example ./save-for-git.sh. If it fails, nothing is pushed.">
        <div className="acts grow">
          <input
            className="text-input mono"
            aria-label="Before each push"
            placeholder="No command"
            disabled={!known}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && commit()}
          />
          {changed && (
            <button className="btn blue" onClick={commit}>
              Save
            </button>
          )}
          {!changed && f.settings.beforePush !== null && (
            <button className="btn" onClick={() => save({ beforePush: null })}>
              Clear
            </button>
          )}
        </div>
      </Field>
    </div>
  )
}

function Field({ label, info, children }: { label: string; info: string; children: ReactNode }) {
  return (
    <div className="kv-field">
      <span className="kv-label">
        {label} <Info text={info} />
      </span>
      {children}
    </div>
  )
}

/** The explanation, on hover: the page stays one line a setting. */
export function Info({ text }: { text: string }) {
  return (
    <span className="info" title={text} aria-label={text} role="img">
      <Icon name="info" />
    </span>
  )
}
