import { useState } from 'react'
import type { AppStatus, FolderStatus } from '@shared/types'
import { parentDir, tildify } from '../lib/format'
import { folderView, summary } from '../lib/summary'
import { Icon } from './Icon'
import { Ago } from './Time'

interface Props {
  status: AppStatus
  selected: string | null
  home: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
}

export function Sidebar({ status, selected, home, onSelect, onAdd }: Props) {
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
                  <div className="sub">{summary(status)}</div>
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
    <button className={`plain row ${selected ? 'sel' : ''} ${v.cls === 'off' ? 'dim' : ''}`} onClick={onSelect}>
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
