import { useEffect, useState } from 'react'
import type { FolderStatus } from '@shared/types'
import { Sheet } from './Sheets'

/**
 * D44: pick the folders a repo syncs. The tree opens one level at a time, so a big repo is never
 * read at once; what git ignores is not offered. A picked folder covers everything below it.
 */
export function FolderPickerSheet({ folder: f, onClose }: { folder: FolderStatus; onClose: () => void }) {
  const [whole, setWhole] = useState(f.settings.paths === null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(f.settings.paths ?? []))
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  // A status push hands in a new array with the same picks: only a real change reads again.
  const saved = JSON.stringify(f.settings.paths)

  // A picked folder that is gone stays picked until the user drops it, marked "not found".
  useEffect(() => {
    let live = true
    const paths = JSON.parse(saved) as string[] | null
    const parents = [...new Set((paths ?? []).map(parentOf))]
    void Promise.all(parents.map((p) => window.autosync.listFolders(f.id, p).catch(() => [] as string[]))).then((lists) => {
      if (!live) return
      const seen = new Set(lists.flat())
      setMissing(new Set((paths ?? []).filter((p) => !seen.has(p))))
    })
    return () => {
      live = false
    }
  }, [f.id, saved])

  const toggle = (rel: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else {
        // A parent covers its children: they are dropped, not kept twice.
        for (const p of next) if (p.startsWith(`${rel}/`)) next.delete(p)
        next.add(rel)
      }
      return next
    })

  const paths = [...picked].sort()
  async function save() {
    await window.autosync.setRepoSettings(f.id, { ...f.settings, paths: whole ? null : paths })
    onClose()
  }

  return (
    <Sheet
      title={`Folders to sync in “${f.name}”`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn blue" disabled={!whole && paths.length === 0} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="radio">
        <input type="radio" name="scope" checked={whole} onChange={() => setWhole(true)} />
        The whole repo
      </label>
      <label className="radio">
        <input type="radio" name="scope" checked={!whole} onChange={() => setWhole(false)} />
        Only these folders
      </label>
      {!whole && (
        <>
          <div className="tree" role="tree" aria-label="Folders">
            <Level folderId={f.id} rel="" picked={picked} onToggle={toggle} />
          </div>
          {[...missing].filter((p) => picked.has(p)).map((p) => (
            <label className="tree-row" key={p}>
              <input type="checkbox" checked onChange={() => toggle(p)} />
              <span className="mono">{p}</span>
              <span className="muted">not found</span>
            </label>
          ))}
          <p className="muted last">
            {paths.length === 0
              ? 'Pick at least one folder.'
              : 'Files outside these folders stay on this computer. AutoSync lists them under “What’s not syncing”. Pulls still bring in the whole repo.'}
          </p>
        </>
      )}
    </Sheet>
  )
}

const parentOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

interface LevelProps {
  folderId: string
  rel: string
  picked: ReadonlySet<string>
  onToggle: (rel: string) => void
}

/** The folders right under `rel`, read when this level first shows. */
function Level({ folderId, rel, picked, onToggle }: LevelProps) {
  const [children, setChildren] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    void window.autosync
      .listFolders(folderId, rel)
      .catch(() => [] as string[])
      .then((list) => live && setChildren(list))
    return () => {
      live = false
    }
  }, [folderId, rel])

  if (children === null) return <div className="tree-row muted">Reading…</div>
  if (children.length === 0 && rel === '') return <div className="tree-row muted">No folders in this repo.</div>
  return (
    <>
      {children.map((child) => (
        <Node key={child} folderId={folderId} rel={child} picked={picked} onToggle={onToggle} />
      ))}
    </>
  )
}

function Node({ folderId, rel, picked, onToggle }: LevelProps) {
  const [open, setOpen] = useState(false)
  const covered = [...picked].some((p) => rel.startsWith(`${p}/`))
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return (
    <div className="tree-node" role="treeitem" aria-expanded={open}>
      <div className="tree-row">
        <button className="twisty" aria-label={open ? `Close ${name}` : `Open ${name}`} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <label>
          <input type="checkbox" aria-label={rel} checked={covered || picked.has(rel)} disabled={covered} onChange={() => onToggle(rel)} />
          {name}
        </label>
      </div>
      {open && (
        <div className="tree-kids">
          <Level folderId={folderId} rel={rel} picked={picked} onToggle={onToggle} />
        </div>
      )}
    </div>
  )
}
