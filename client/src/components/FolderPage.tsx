import type { ReactNode } from 'react'
import type { AppStatus, Attention, FolderStatus } from '@shared/types'
import { CHECKS_EVERY, OPENS_PR_AFTER, plural, SENDS_AFTER } from '@shared/status'
import { formatBytes, isGitHubUrl, tildify, webLabel } from '../lib/format'
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
  const problem = f.attention && f.attention.kind !== 'no-git' && active && !status.gitMissing ? f.attention : null
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
            {f.publishVia === 'pr' && (
              <span className="pill">
                <Icon name="up" />
                Publishes through pull requests
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

      {problem && <ProblemCard folder={f} attention={problem} />}
      {f.tooBig.length > 0 && f.enabled && <TooBigCard folder={f} />}

      <NotSyncing folder={f} view={v} paused={status.paused} />
      <ActivityLog key={f.id} folder={f} />

      <div className="section">
        <div className="actions">
          <Action title={`View the files in ${platform.fileManager}`} detail={<span className="kbd">{platform.shortcut('F')}</span>}>
            <button className="btn" onClick={() => api.showInFinder(f.id)}>
              Reveal in {platform.fileManager}
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
      if (f.pr) {
        return (
          <>
            Waiting on <GitHubLink url={f.pr.url}>PR #{f.pr.number}</GitHubLink> — synced once it's merged into {f.branch ?? 'main'}.
          </>
        )
      }
      if (f.sendAt === null) return <>Waiting for the next pass.</>
      return f.publishVia === 'pr' ? (
        <>
          Opens a PR in <Countdown at={f.sendAt} /> — {OPENS_PR_AFTER}.
        </>
      ) : (
        <>
          Sends in <Countdown at={f.sendAt} /> — {SENDS_AFTER}.
        </>
      )
    case 'synced':
      return (
        <>
          <LastSynced at={f.lastSyncedAt} /> · checks GitHub {CHECKS_EVERY}
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
      if (a.detail === 'side-branch') {
        return {
          title: 'On a side branch — switch back to the main branch to sync',
          body: 'This repo publishes through pull requests, so AutoSync only syncs its main branch. Nothing on this branch is touched.',
        }
      }
      return a.detail === 'detached'
        ? {
            title: "This folder isn't on a branch",
            body: "Git is looking at an old snapshot instead of a branch (a “detached HEAD”). AutoSync won't touch the folder until it's back on its branch, so nothing gets mixed up.",
          }
        : {
            title: `This folder is in the middle of a ${a.detail === 'merge' ? 'merge' : 'rebase'}`,
            body: `Someone (probably you, by hand) started a ${a.detail === 'merge' ? 'merge' : 'rebase'} here and didn't finish it. AutoSync won't touch the folder until it's done, so nothing gets mixed up.`,
          }
    case 'no-gh':
      return {
        title: "The GitHub CLI isn't set up",
        body: `This repo only takes changes through pull requests, and AutoSync opens them with the GitHub CLI (“gh”), which is missing or logged out on ${platform.here}. It's a one-time setup — your changes are safe here until then.`,
      }
    case 'pr-closed':
      return {
        title: 'Someone closed the pull request without merging it',
        body: `Your changes are safe on ${platform.here} — nothing is thrown away. Reopen the PR on GitHub and it will merge and land here, or press Send again to open a fresh one.`,
      }
    case 'other-app': {
      const app = a.detail ?? 'Docs'
      return {
        title: `The ${app} app also syncs this folder`,
        body: `One folder, one syncer: AutoSync is standing back and changing nothing until one of them is off. Turn off GitHub sync for this folder in the ${app} app, or turn this folder off here.`,
      }
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
      {(a.kind === 'auth' || a.kind === 'error' || a.kind === 'no-gh') && a.detail && <div className="prompt">{a.detail}</div>}
      {a.kind === 'pr-closed' && a.detail && (
        <div className="cb">
          <GitHubLink url={a.detail}>{webLabel(a.detail)}</GitHubLink>
        </div>
      )}
      <div className="acts">
        {a.kind === 'pr-closed' && (
          <button className="btn blue" onClick={() => window.autosync.resendPullRequest(f.id)}>
            <Icon name="up" />
            Send again
          </button>
        )}
        <CopyPromptButton text={prompt} className={a.kind === 'pr-closed' ? 'btn' : 'btn blue'} />
        <button className="btn" onClick={() => window.autosync.showInFinder(f.id)}>
          <Icon name="folder" />
          Reveal in {platform.fileManager}
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
            {platform.here} only. Everything else synced.
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
        : f.pr
          ? `Waiting — in PR #${f.pr.number}`
          : f.publishVia === 'pr'
            ? `Waiting — opens a PR ${OPENS_PR_AFTER}`
            : `Waiting — sends ${SENDS_AFTER}`
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

/** A github.com link (`openExternal` opens nothing else); anything else shows as plain text. */
function GitHubLink({ url, children }: { url: string; children: ReactNode }) {
  return isGitHubUrl(url) ? (
    <button className="link" onClick={() => window.autosync.openExternal(url)}>
      {children}
    </button>
  ) : (
    <>{children}</>
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
