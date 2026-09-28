import type { AppStatus } from '@shared/types'
import { plural } from '../lib/format'
import { folderView, overall, RANK } from '../lib/summary'
import { Icon } from './Icon'
import { Ago } from './Time'

export function Overview({ status, onSelect }: { status: AppStatus; onSelect: (id: string) => void }) {
  const o = overall(status)
  const rows = status.folders
    .map((f) => ({ f, v: folderView(f, status) }))
    .sort((a, b) => RANK[b.v.cls] - RANK[a.v.cls] || (b.f.lastSyncedAt ?? 0) - (a.f.lastSyncedAt ?? 0))

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>All folders</h1>
          <div className="path">
            {plural(o.total, 'folder')} on {status.hostname}
          </div>
        </div>
      </div>
      <div className="ov-grid">
        <Stat value={o.synced} dot="synced" label="Synced" />
        <Stat value={o.pending + o.syncing} dot="pending" label="Waiting · syncing" />
        <Stat value={o.attention} dot="attention" label="Need you" />
        <Stat value={o.off} dot="off" label="Sync off" />
      </div>
      <div className="section">
        <h2>
          Folders <span className="hint">Needs-you first</span>
        </h2>
        <div className="tbl">
          {rows.map(({ f, v }) => (
            <button key={f.id} className="plain tr click ov-row" onClick={() => onSelect(f.id)}>
              <span className={`dot ${v.cls}`} />
              <div className="grow">
                <div className="nm">
                  {f.name}
                  {f.alsoSyncedBy && (
                    <span className="pill warn small">
                      <Icon name="alert" />
                      also {f.alsoSyncedBy}
                    </span>
                  )}
                </div>
                <div className="ds">
                  {f.lastSyncedAt === null ? (
                    'Not synced yet'
                  ) : (
                    <>
                      Last synced <Ago at={f.lastSyncedAt} />
                    </>
                  )}
                </div>
              </div>
              <span className={`tag ${v.cls}`}>{v.short}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function Stat({ value, dot, label }: { value: number; dot: string; label: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">
        <span className={`dot ${dot}`} />
        {label}
      </div>
    </div>
  )
}
