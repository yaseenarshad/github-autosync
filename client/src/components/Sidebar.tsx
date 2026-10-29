import { useState } from 'react'
import type { AppStatus, FolderStatus, FolderVerdict, OtherRepo } from '@shared/types'
import { parentDir, tildify } from '../lib/format'
import { headline } from '@shared/status'
import { folderView } from '../lib/summary'
import { Icon } from './Icon'
import { Ago } from './Time'

interface Props {
  status: AppStatus
  selected: string | null
  home: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
  /** D53: a one-click Add whose checks failed shows the Add sheet with the reason. */
  onAddFailed: (verdict: FolderVerdict) => void
}

export function Sidebar({ status, selected, home, onSelect, onAdd, onAddFailed }: Props) {
  const [filter, setFilter] = useState('')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const q = filter.trim().toLowerCase()

  const groups = new Map<string, FolderStatus[]>()
  for (const f of status.folders) {
    if (q && !f.name.toLowerCase().includes(q)) continue
    const dir = parentDir(f.path)
    groups.set(dir, [...(groups.get(dir) ?? []), f])
  }

  function toggle(dir: string) {
    const next = new Set(closed)
    if (!next.delete(dir)) next.add(dir)
    setClosed(next)
  }

  return (
    <aside className="sidebar">
      <div className="side-head">
        <label className="filter">
          <Icon name="search" style={{ width: 14, height: 14 }} />
          <input placeholder="Filter folders" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </div>
      <div className="list">
        {status.folders.length === 0 ? (
          <div className="list-note center">
            No folders yet.
            <br />
            Add one below to start.
          </div>
        ) : (
          <>
            {!q && (
              <button className={`plain row ${selected === null ? 'sel' : ''}`} onClick={() => onSelect(null)}>
                <span className="ov-ico">
                  <Icon name="grid" style={{ width: 14, height: 14 }} />
                </span>
                <div>
                  <div className="name">All folders</div>
                  <div className="sub">{headline(status)}</div>
                </div>
                <span className="count">{status.folders.length}</span>
              </button>
            )}
            {[...groups].map(([dir, folders]) => {
              const isClosed = closed.has(dir) && !q
              return (
                <div key={dir}>
                  <button className={`plain group ${isClosed ? 'closed' : ''}`} onClick={() => toggle(dir)}>
                    <Icon name="chev" className="ico chev" />
                    <span className="gp">{tildify(dir, home)}</span>
                    <span className="gc">{folders.length}</span>
                  </button>
                  {!isClosed &&
                    folders.map((f) => (
                      <FolderRow key={f.id} folder={f} status={status} selected={f.id === selected} onSelect={() => onSelect(f.id)} />
                    ))}
                </div>
              )
            })}
            {q && groups.size === 0 && <div className="list-note">No folders match “{filter.trim()}”.</div>}
          </>
        )}
        <OtherComputers others={status.others.filter((o) => !o.hidden)} home={home} onAddFailed={onAddFailed} />
      </div>
      <div className="side-foot">
        <button className="btn-quiet" onClick={onAdd}>
          <Icon name="plus" style={{ width: 14, height: 14 }} />
          Add folder
        </button>
      </div>
    </aside>
  )
}

/** D53, D54: repos the other computers sync and this one does not. Nothing turns on before a click. */
function OtherComputers({ others, home, onAddFailed }: { others: OtherRepo[]; home: string | null; onAddFailed: (verdict: FolderVerdict) => void }) {
  const [closed, setClosed] = useState(false)
  if (others.length === 0) return null
  const api = window.autosync
  async function add(key: string) {
    const verdict = await api.addOther(key)
    if (!verdict.ok) onAddFailed(verdict)
  }
  return (
    <div className="others">
      <button className={`plain group ${closed ? 'closed' : ''}`} onClick={() => setClosed(!closed)}>
        <Icon name="chev" className="ico chev" />
        <span>On your other computers</span>
        <span className="gc">{others.length}</span>
      </button>
      {!closed &&
        others.map((o) => (
          <div className="other" key={o.key}>
            <div className="min0">
              <div className="name">{o.name}</div>
              <div className="sub" title={o.error ?? undefined}>
                {o.cloning ? 'Cloning…' : o.error !== null ? o.error : o.found !== null ? tildify(o.found, home) : `Not here yet · on ${o.computers.join(', ')}`}
              </div>
            </div>
            <div className="acts">
              {o.found !== null ? (
                <button className="btn" onClick={() => add(o.key)}>
                  Add
                </button>
              ) : (
                <button className="btn" disabled={o.cloning} onClick={() => api.cloneOther(o.key)}>
                  Clone…
                </button>
              )}
              <button className="x" aria-label={`Not on this computer: ${o.name}`} title="Not on this computer" onClick={() => api.hideOther(o.key)}>
                ×
              </button>
            </div>
          </div>
        ))}
    </div>
  )
}

function FolderRow({
  folder: f,
  status,
  selected,
  onSelect,
}: {
  folder: FolderStatus
  status: AppStatus
  selected: boolean
  onSelect: () => void
}) {
  const v = folderView(f, status)
  return (
    <button
      className={`plain row ${selected ? 'sel' : ''} ${v.cls === 'off' ? 'dim' : ''}`}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect()
        void window.autosync.showFolderMenu(f.id)
      }}
    >
      <span className={`dot ${v.cls}`} />
      <div className="min0">
        <div className="name">{f.name}</div>
        <div className="sub">
          {v.kind === 'synced' && f.lastSyncedAt !== null ? (
            <>
              Synced <Ago at={f.lastSyncedAt} />
            </>
          ) : (
            v.short
          )}
          {f.alsoSyncedBy && ` · also ${f.alsoSyncedBy}`}
        </div>
      </div>
      {f.pending.length > 0 && v.cls !== 'off' && <span className="count">{f.pending.length}</span>}
    </button>
  )
}
