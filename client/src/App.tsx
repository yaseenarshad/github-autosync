import { useEffect, useState } from 'react'
import type { AppStatus } from '@shared/types'
import { pickAndCheck } from './components/AddFolderSheet'
import { Banners } from './components/Banners'
import { FirstRun } from './components/FirstRun'
import { FolderPage } from './components/FolderPage'
import { IconSprite } from './components/Icon'
import { Overview } from './components/Overview'
import { AppSheet, type SheetState } from './components/Sheets'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { homeDir } from './lib/format'

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  /** Folder id; null = All folders. */
  const [selected, setSelected] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetState | null>(null)

  useEffect(() => {
    const api = window.autosync
    const offStatus = api.onStatus(setStatus)
    const offNavigate = api.onNavigate((target) => {
      setSelected(target.folderId)
      setSheet(target.sheet ? { kind: target.sheet } : null)
    })
    void api.getStatus().then(setStatus)
    return () => {
      offStatus()
      offNavigate()
    }
  }, [])

  const titlebar = <div className="titlebar">GitHub AutoSync</div>
  if (!status) return <div className="window">{titlebar}</div>

  const folder = status.folders.find((f) => f.id === selected) ?? null
  const home = homeDir(status.folders[0]?.path)

  async function openAdd() {
    const verdict = await pickAndCheck()
    if (verdict) setSheet({ kind: 'add', verdict })
  }

  return (
    <div className="window">
      <IconSprite />
      {titlebar}
      <Toolbar status={status} folder={folder} onOverview={() => setSelected(null)} onSheet={setSheet} />
      <div className="body">
        <Sidebar status={status} selected={folder?.id ?? null} home={home} onSelect={setSelected} onAdd={openAdd} />
        <main className="main">
          {status.folders.length === 0 ? (
            <FirstRun onAdd={openAdd} />
          ) : (
            <>
              <Banners status={status} onResume={() => setSheet({ kind: 'resume' })} />
              <div className="main-inner">
                {folder ? (
                  <FolderPage folder={folder} status={status} home={home} onSheet={setSheet} />
                ) : (
                  <Overview status={status} onSelect={setSelected} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
      {sheet && <AppSheet sheet={sheet} status={status} home={home} onClose={() => setSheet(null)} onSelect={setSelected} />}
    </div>
  )
}
