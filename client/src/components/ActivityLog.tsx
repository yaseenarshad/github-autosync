import { Fragment, useEffect, useState } from 'react'
import type { ActivityEntry, ActivityKind, ActivityPage, FolderStatus } from '@shared/types'
import {
  appendPage,
  fileList,
  filterEntries,
  groupDays,
  groupRuns,
  mergeFirstPage,
  uniqueFiles,
  type ActivityFilter,
  type Day,
} from '../lib/activity'
import { plural } from '../lib/format'
import { clock, exact, MINUTE } from '../lib/time'
import { Icon, type IconName } from './Icon'
import { Ago, Stamp, useNow } from './Time'

const FIRST_DAYS = 4
const MORE_DAYS = 7

const KIND: Record<ActivityKind, { icon: IconName; cls: string }> = {
  sent: { icon: 'up', cls: 'up' },
  received: { icon: 'down', cls: 'down' },
  conflict: { icon: 'alert', cls: 'x' },
  manual: { icon: 'computer', cls: '' },
}

function title(e: ActivityEntry): string {
  switch (e.kind) {
    case 'sent':
      return `Sent ${plural(e.files.length, 'file')} from this Mac`
    case 'received':
      return `Received ${plural(e.files.length, 'file')} from ${e.host}`
    case 'conflict':
      return `Conflict with ${e.host} — both versions kept`
    case 'manual':
      return `Committed by ${e.host}: ${e.subject}`
  }
}

/** Mounted per folder (keyed by id), so switching folders starts fresh. */
export function ActivityLog({ folder }: { folder: FolderStatus }) {
  const [log, setLog] = useState<ActivityPage | null>(null)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [query, setQuery] = useState('')
  const [dayLimit, setDayLimit] = useState(FIRST_DAYS)
  const [openDays, setOpenDays] = useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const now = useNow()

  // A finished sync may have added commits: refresh the newest page, keep older pages already loaded.
  useEffect(() => {
    let live = true
    void window.autosync.activity(folder.id).then((first) => live && setLog((prev) => (prev ? mergeFirstPage(prev, first) : first)))
    return () => {
      live = false
    }
  }, [folder.id, folder.lastSyncedAt])

  const entries = log?.entries ?? []
  const shown = filterEntries(entries, filter, query)
  const days = groupDays(shown, now)
  const searching = query.trim() !== ''
  const visible = searching ? days : days.slice(0, dayLimit)
  const canLoadMore = !searching && (days.length > dayLimit || (log !== null && log.cursor !== null))
  const count = (k: ActivityKind) => entries.filter((e) => e.kind === k).length

  async function loadOlder() {
    const limit = dayLimit + MORE_DAYS
    setDayLimit(limit)
    if (log && log.cursor !== null && days.length <= limit) {
      const older = await window.autosync.activity(folder.id, log.cursor)
      setLog((prev) => prev && appendPage(prev, older))
    }
  }

  function toggle(key: string) {
    const next = new Set(expanded)
    if (!next.delete(key)) next.add(key)
    setExpanded(next)
  }

  const isOpen = (day: Day, i: number) => searching || (openDays[day.key] ?? i === 0)

  function entryRow(e: ActivityEntry, nested = false) {
    const open = expanded.has(e.sha)
    return (
      <Fragment key={e.sha}>
        <button className={`plain log ${open ? 'open' : ''} ${nested ? 'nested' : ''}`} onClick={() => toggle(e.sha)}>
          <div className="when">
            <div className="c">{clock(e.time)}</div>
            <div className="a">
              <Ago at={e.time} />
            </div>
          </div>
          <span className={`arrow ${KIND[e.kind].cls}`}>
            <Icon name={KIND[e.kind].icon} />
          </span>
          <div className="grow">
            <div className="who">{title(e)}</div>
            <div className="what">{fileList(e.files)}</div>
          </div>
          <Icon name="chev" className="ico chev" />
        </button>
        {open && (
          <div className={`logd ${nested ? 'nested' : ''}`}>
            {e.files.map((f) => (
              <div className="lf" key={f.path}>
                <span className={`st ${f.status}`}>{f.status}</span>
                <span className="f">{f.path}</span>
              </div>
            ))}
            <div className="meta">
              Commit <span className="mono">{e.sha.slice(0, 7)}</span> · <span className="mono">{e.subject}</span>
              {folder.webUrl && (
                <>
                  {' · '}
                  <button className="link" onClick={() => window.autosync.openExternal(`${folder.webUrl}/commit/${e.sha}`)}>
                    View on GitHub
                  </button>
                </>
              )}
              {' · '}
              {exact(e.time, now)}
            </div>
          </div>
        )}
      </Fragment>
    )
  }

  function runRow(run: ActivityEntry[]) {
    const [newest, oldest] = [run[0], run[run.length - 1]]
    const key = `run:${newest.sha}`
    const open = expanded.has(key)
    const files = uniqueFiles(run)
    const minutes = Math.max(1, Math.round((newest.time - oldest.time) / MINUTE))
    return (
      <Fragment key={key}>
        <button className={`plain log ${open ? 'open' : ''}`} onClick={() => toggle(key)}>
          <div className="when">
            <div className="c">{clock(newest.time)}</div>
            <div className="a">from {clock(oldest.time)}</div>
          </div>
          <span className={`arrow ${KIND[newest.kind].cls} stack`}>
            <Icon name={KIND[newest.kind].icon} />
            <b>{run.length}</b>
          </span>
          <div className="grow">
            <div className="who">
              {newest.kind === 'sent' ? 'Sent' : 'Received'} {run.length} times from {newest.kind === 'sent' ? 'this Mac' : newest.host}{' '}
              <span className="muted normal">
                · {plural(files.length, 'file')} · {minutes} min
              </span>
            </div>
            <div className="what">{fileList(files)}</div>
          </div>
          <Icon name="chev" className="ico chev" />
        </button>
        {open && run.map((e) => entryRow(e, true))}
      </Fragment>
    )
  }

  const chip = (k: ActivityFilter, label: string) => (
    <button className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
      {label}
      {k !== 'all' && <span className="cn"> {count(k)}</span>}
    </button>
  )

  return (
    <div className="section">
      <h2>
        Activity <span className="n normal">· from git history</span>
        <span className="hint">
          {folder.lastCheckedAt === null ? (
            'Not checked GitHub yet'
          ) : (
            <>
              Last checked GitHub <Stamp at={folder.lastCheckedAt} />
            </>
          )}
        </span>
      </h2>
      <div className="chips">
        {chip('all', 'All')}
        {chip('sent', 'Sent')}
        {chip('received', 'Received')}
        {chip('conflict', 'Conflicts')}
        <label className="filter logsearch">
          <Icon name="search" style={{ width: 13, height: 13 }} />
          <input placeholder="Find a file…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {log && days.length === 0 ? (
        <div className="tbl">
          <div className="tr muted">{searching ? `No syncs touched a file matching “${query.trim()}”.` : 'Nothing here yet.'}</div>
        </div>
      ) : (
        days.length > 0 && (
          <div className="tbl logs">
            {visible.map((day, i) => {
              const open = isOpen(day, i)
              return (
                <Fragment key={day.key}>
                  <button className={`plain day ${open ? 'open' : ''}`} onClick={() => setOpenDays({ ...openDays, [day.key]: !open })}>
                    <Icon name="chev" className="ico chev" />
                    <span>{day.name}</span>
                    <span className="ds">
                      {plural(day.entries.length, 'sync')} · {plural(day.files, 'file')}
                      {day.sent > 0 && (
                        <>
                          {' '}
                          · <span className="s-up">↑{day.sent}</span>
                        </>
                      )}
                      {day.received > 0 && (
                        <>
                          {' '}
                          · <span className="s-down">↓{day.received}</span>
                        </>
                      )}
                      {day.conflicts > 0 && (
                        <>
                          {' '}
                          · <span className="s-x">⚠{day.conflicts}</span>
                        </>
                      )}
                    </span>
                  </button>
                  {open && groupRuns(day.entries).map((run) => (run.length === 1 ? entryRow(run[0]) : runRow(run)))}
                </Fragment>
              )
            })}
          </div>
        )
      )}
      {canLoadMore && (
        <button className="btn-quiet more" onClick={loadOlder}>
          {days.length > dayLimit ? `Load ${Math.min(MORE_DAYS, days.length - dayLimit)} older days` : 'Load older days'}
        </button>
      )}
    </div>
  )
}
