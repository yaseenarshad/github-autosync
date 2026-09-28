import { useEffect, useState } from 'react'
import type { AppStatus, FolderStatus, NavTarget } from '@shared/types'
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
import { platform } from './lib/platform'
import { attentionPrompt } from './lib/prompts'

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
      setSheet(sheetFor(target))
      if (target.copyPrompt && target.folderId) void copyAttentionPrompt(target.folderId)
    })
    void api.getStatus().then(setStatus)
    return () => {
      offStatus()
      offNavigate()
    }
  }, [])

  const folder = status?.folders.find((f) => f.id === selected) ?? null
  useFolderShortcuts(sheet ? null : folder)

  const titlebar = <div className="titlebar">GitHub AutoSync</div>
  if (!status) return <div className="window">{titlebar}</div>

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

/** The action list's shortcuts: ⌘⇧F / ⌘⇧G on a Mac, Ctrl+Shift+F / Ctrl+Shift+G elsewhere. Off when `folder` is null. */
function useFolderShortcuts(folder: FolderStatus | null) {
  const id = folder?.id
  const webUrl = folder?.webUrl
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || !(platform.mac ? e.metaKey : e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'f') void window.autosync.showInFinder(id)
      else if (key === 'g' && webUrl) void window.autosync.openExternal(webUrl)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [id, webUrl])
}

function sheetFor({ sheet, folderId }: NavTarget): SheetState | null {
  if (sheet === 'settings' || sheet === 'pause' || sheet === 'resume') return { kind: sheet }
  return sheet && folderId ? { kind: sheet, id: folderId } : null
}

/** The right-click menu's "Copy AI prompt" (D18): the prompt texts live here, so main asks the window to copy. */
async function copyAttentionPrompt(folderId: string) {
  const folder = (await window.autosync.getStatus()).folders.find((f) => f.id === folderId)
  if (folder?.attention) await window.autosync.copyText(attentionPrompt(folder, folder.attention))
}
