import type { AppStatus, FolderStatus } from '@shared/types'
import { folderView, overall, summary } from '../lib/summary'
import { Icon } from './Icon'
import type { SheetState } from './Sheets'
import { LastSynced } from './Time'

interface Props {
  status: AppStatus
  folder: FolderStatus | null
  onOverview: () => void
  onSheet: (sheet: SheetState) => void
}

export function Toolbar({ status, folder, onOverview, onSheet }: Props) {
  const o = overall(status)
  const empty = status.folders.length === 0
  const busy = folder ? folderView(folder, status).cls === 'syncing' : o.syncing > 0
  const lastSynced = folder ? folder.lastSyncedAt : latest(status.folders.filter((f) => f.enabled).map((f) => f.lastSyncedAt))

  return (
    <div className="toolbar">
      <button className="tb tb-1" title="All folders" onClick={onOverview}>
        <span className={`dot ${o.worst}`} />
        <span className="txt">
          <div className="lbl">GitHub AutoSync</div>
          <div className="val">{summary(status, o)}</div>
        </span>
      </button>
      <div className="tb tb-2">
        <Icon name="branch" />
        <span className="txt">
          <div className="lbl">{folder ? 'Syncing branch' : 'This computer'}</div>
          <div className="val">{folder ? `${folder.branch ?? 'No branch'} ⇄ origin` : status.hostname}</div>
        </span>
      </div>
      <button
        className={`tb tb-3 ${busy ? 'spin' : ''}`}
        disabled={empty || status.paused || (folder !== null && !folder.enabled)}
        onClick={() => window.autosync.syncNow(folder?.id ?? null)}
      >
        <Icon name="sync" />
        <span className="txt">
          <div className="val">{folder ? 'Sync now' : 'Sync all now'}</div>
          <div className="lbl">{busy ? 'Syncing…' : empty ? 'Add a folder first' : <LastSynced at={lastSynced} />}</div>
        </span>
      </button>
      <div className="tb tb-fill" />
      <button
        className="tb tb-small"
        title={status.paused ? 'Resume all syncing' : 'Pause all syncing'}
        onClick={() => onSheet({ kind: status.paused ? 'resume' : 'pause' })}
      >
        <Icon name={status.paused ? 'play' : 'pause'} />
        <span className="val">{status.paused ? 'Resume' : 'Pause all'}</span>
      </button>
      <button className="tb tb-small" title="Settings" aria-label="Settings" onClick={() => onSheet({ kind: 'settings' })}>
        <Icon name="gear" />
      </button>
    </div>
  )
}

function latest(times: (number | null)[]): number | null {
  const known = times.filter((t) => t !== null)
  return known.length ? Math.max(...known) : null
}
