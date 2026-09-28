import type { ReactNode } from 'react'
import type { AppStatus, Attention, FolderStatus } from '@shared/types'
import { formatBytes, plural, tildify, webLabel } from '../lib/format'
import { platform } from '../lib/platform'
import { attentionPrompt, tooBigPrompt } from '../lib/prompts'
import { folderView, type FolderView } from '../lib/summary'
import { ActivityLog } from './ActivityLog'
import { CopyPromptButton } from './CopyPromptButton'
import { Icon } from './Icon'
import type { SheetState } from './Sheets'
import { Countdown, LastSynced } from './Time'

interface Props {
  folder: FolderStatus
  status: AppStatus
  home: string | null
  onSheet: (sheet: SheetState) => void
}

export function FolderPage({ folder: f, status, home, onSheet }: Props) {
  const v = folderView(f, status)
  const active = f.enabled && !status.paused
  const api = window.autosync

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{f.name}</h1>
          <div className="path">{tildify(f.path, home)}</div>
          <div className="pills">
            <span className="pill">
              <Icon name="branch" />
              {f.branch ?? 'No branch'} ⇄ origin
            </span>
            {(f.webUrl || f.remoteUrl) && (
              <span className="pill">
                <Icon name="ext" />
                {f.webUrl ? webLabel(f.webUrl) : f.remoteUrl}
              </span>
            )}
            {f.alsoSyncedBy && (
              <span className="pill warn">
                <Icon name="alert" />
                Also synced by {f.alsoSyncedBy} app
              </span>
            )}
          </div>
        </div>
        <button
          className={`switch ${f.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={f.enabled}
          onClick={() => onSheet({ kind: f.enabled ? 'folder-off' : 'folder-on', id: f.id })}
        >
          <span>{f.enabled ? 'Syncing' : 'Sync off'}</span>
          <span className="track" />
        </button>
      </div>

      <div className={`status ${v.cls}`}>
        <div className="big">
          <Icon name={v.icon} />
        </div>
        <div className="grow">
          <div className="h">{v.head}</div>
          <div className="s">
            <StatusSub folder={f} view={v} />
          </div>
        </div>
        {active && !status.gitMissing && v.cls !== 'syncing' && (
          <button className="btn" onClick={() => api.syncNow(f.id)}>
            <Icon name="sync" />
            Sync now
          </button>
        )}
      </div>

      {f.attention && f.attention.kind !== 'no-git' && active && !status.gitMissing && <ProblemCard folder={f} attention={f.attention} />}
      {f.alsoSyncedBy && f.enabled && (
        <div className="card warn">
          <div className="ct">
            <Icon name="alert" />
            The {f.alsoSyncedBy} app also syncs this folder
          </div>
          <div className="cb">
            Both apps will sync it. Nothing gets lost, but you may see a “busy” error now and then. To keep it quiet, turn sync off here or
            in {f.alsoSyncedBy}.
          </div>
        </div>
      )}
      {f.tooBig.length > 0 && f.enabled && <TooBigCard folder={f} />}

      <NotSyncing folder={f} view={v} paused={status.paused} />
      <ActivityLog key={f.id} folder={f} />

      <div className="section">
        <div className="actions">
          <Action title={`View the files in ${platform.fileManager}`} detail={<span className="kbd">{platform.shortcut('F')}</span>}>
            <button className="btn" onClick={() => api.showInFinder(f.id)}>
              Show in {platform.fileManager}
            </button>
          </Action>
          {f.webUrl && (
            <Action title="Open the repository on GitHub" detail={<span className="kbd">{platform.shortcut('G')}</span>}>
              <button className="btn" onClick={() => api.openExternal(f.webUrl!)}>
                View on GitHub
              </button>
            </Action>
          )}
          <Action title="Stop syncing this folder" detail={`Removes it from AutoSync only. Files stay on ${platform.yours} and on GitHub.`}>
            <button className="btn red" onClick={() => onSheet({ kind: 'remove', id: f.id })}>
              <Icon name="trash" />
              Remove
            </button>
          </Action>
        </div>
      </div>
    </>
  )
}

function StatusSub({ folder: f, view }: { folder: FolderStatus; view: FolderView }) {
  switch (view.kind) {
    case 'off':
      return <>Nothing is committed, pulled, or pushed. Turn it on to start again.</>
    case 'paused':
      return <>All folders are paused. Resume to catch up.</>
    case 'git-missing':
      return <>AutoSync needs git to do anything. See the banner above.</>
    case 'attention':
      return (
        <>
          <LastSynced at={f.lastSyncedAt} /> · see below
        </>
      )
    case 'syncing':
      return <>Commit → pull → push</>
    case 'offline':
      return (
        <>
          {f.pending.length
            ? `${plural(f.pending.length, 'change')} ${f.pending.length === 1 ? 'is' : 'are'} saved here and will send when you're back online.`
            : 'Nothing is waiting to send.'}
          {f.retryAt !== null && (
            <>
              {' '}
              Retrying in <Countdown at={f.retryAt} />.
            </>
          )}
        </>
      )
    case 'pending':
      return f.sendAt === null ? (
        <>Waiting for the next pass.</>
      ) : (
        <>
          Sends in <Countdown at={f.sendAt} /> — 30 seconds after you stop editing.
        </>
      )
    case 'synced':
      return (
        <>
          <LastSynced at={f.lastSyncedAt} /> · checks GitHub every minute
        </>
      )
  }
}

function problemText(a: Attention): { title: string; body: string } {
  switch (a.kind) {
    case 'conflict': {
      const n = a.conflicts?.length ?? 0
      return {
        title: `${plural(n, 'file')} ${n === 1 ? 'was' : 'were'} edited on two computers`,
        body: `Both versions are kept — nothing is lost and syncing keeps going. The other computer's version stays in place; ${platform.here}'s version is saved next to it. Merge them when you're ready.`,
      }
    }
    case 'auth':
      return {
        title: 'GitHub refused the sign-in',
        body: 'The saved GitHub login for this folder expired or lost access. Your changes are safe here and will send as soon as it works again.',
      }
    case 'no-identity':
      return {
        title: "Git doesn't know your name and email yet",
        body: "Git labels every change with a name and email, and won't save anything without them. It's a one-time setup on this computer — your changes are safe here until then.",
      }
    case 'busy-repo':
      return a.detail === 'detached'
        ? {
            title: "This folder isn't on a branch",
            body: "Git is looking at an old snapshot instead of a branch (a “detached HEAD”). AutoSync won't touch the folder until it's back on its branch, so nothing gets mixed up.",
          }
        : {
            title: `This folder is in the middle of a ${a.detail === 'merge' ? 'merge' : 'rebase'}`,
            body: `Someone (probably you, by hand) started a ${a.detail === 'merge' ? 'merge' : 'rebase'} here and didn't finish it. AutoSync won't touch the folder until it's done, so nothing gets mixed up.`,
          }
    // no-git never gets here: the global banner covers it.
    case 'no-git':
    case 'error':
      return {
        title: 'Git stopped with an error',
        body: "AutoSync hit a problem it can't fix on its own. Your changes are safe here and will send once it's sorted.",
      }
  }
}

function ProblemCard({ folder: f, attention: a }: { folder: FolderStatus; attention: Attention }) {
  const { title, body } = problemText(a)
  const prompt = attentionPrompt(f, a)
  return (
    <div className="card">
      <div className="ct">
        <Icon name="alert" />
        {title}
      </div>
      <div className="cb">{body}</div>
      {a.kind === 'conflict' && (
        <ul className="pairs">
          {a.conflicts?.map((p) => (
            <li key={p.copy}>
              <span>{p.original}</span>
              <span className="copy">↳ {p.copy}</span>
            </li>
          ))}
        </ul>
      )}
      {(a.kind === 'auth' || a.kind === 'error') && a.detail && <div className="prompt">{a.detail}</div>}
      <div className="acts">
        <CopyPromptButton text={prompt} className="btn blue" />
        <button className="btn" onClick={() => window.autosync.showInFinder(f.id)}>
          <Icon name="folder" />
          Show in {platform.fileManager}
        </button>
        <button className="btn" onClick={() => window.autosync.syncNow(f.id)}>
          <Icon name="sync" />I fixed it — check again
        </button>
      </div>
      <details>
        <summary>See the prompt</summary>
        <div className="prompt">{prompt}</div>
      </details>
    </div>
  )
}

function TooBigCard({ folder: f }: { folder: FolderStatus }) {
  const [one] = f.tooBig
  return (
    <div className="card warn">
      <div className="ct">
        <Icon name="alert" />
        {f.tooBig.length === 1
          ? '1 file is too big for GitHub and was skipped'
          : `${f.tooBig.length} files are too big for GitHub and were skipped`}
      </div>
      <div className="cb">
        {f.tooBig.length === 1 ? (
          <>
            <span className="mono">{one.path}</span> is {formatBytes(one.bytes)}. GitHub rejects files over 100 MB, so it stays on{' '}
            {platform.here}
            only. Everything else synced.
          </>
        ) : (
          `GitHub rejects files over 100 MB, so these stay on ${platform.here} only. Everything else synced. They’re listed under “What’s not syncing”.`
        )}
      </div>
      <div className="acts">
        <CopyPromptButton text={tooBigPrompt(f)} />
      </div>
    </div>
  )
}

function NotSyncing({ folder: f, view, paused }: { folder: FolderStatus; view: FolderView; paused: boolean }) {
  const reason = f.offline
    ? 'Waiting — offline'
    : paused || !f.enabled
      ? 'Waiting — paused'
      : view.kind === 'attention' && f.attention?.kind !== 'conflict'
        ? 'Waiting — fix the problem above'
        : 'Waiting — sends 30s after you stop editing'
  const ignored = f.ignored.patterns.length > 0 || f.ignored.count > 0
  const count = f.pending.length + f.tooBig.length + (ignored ? 1 : 0)

  return (
    <div className="section">
      <h2>What's not syncing {count > 0 && <span className="n">{count}</span>}</h2>
      <div className="tbl">
        {count === 0 && (
          <div className="tr">
            <Icon name="check" style={{ color: 'var(--ok)' }} />
            <span className="grow">Nothing — every file in this folder is on GitHub.</span>
          </div>
        )}
        {f.pending.map((c) => (
          <div className="tr" key={c.path}>
            <span className={`st ${c.status}`}>{c.status}</span>
            <span className="f">{c.path}</span>
            <span className="m">{reason}</span>
          </div>
        ))}
        {f.tooBig.map((t) => (
          <div className="tr" key={t.path}>
            <span className="st D" title="Skipped">
              !
            </span>
            <span className="f">{t.path}</span>
            <span className="m">
              Too big ({formatBytes(t.bytes)}) — stays on {platform.here}
            </span>
          </div>
        ))}
        {ignored && (
          <div className="tr">
            <span className="st muted">–</span>
            <span className="f">{f.ignored.patterns.join('  ')}</span>
            <span className="m">{f.ignored.count.toLocaleString()} files ignored by your .gitignore</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Action({ title, detail, children }: { title: string; detail: ReactNode; children: ReactNode }) {
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
