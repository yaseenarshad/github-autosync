import { useEffect, useRef, useState } from 'react'
import type { FolderStatus } from '@shared/types'
import { platform } from '../lib/platform'
import { Icon } from './Icon'

/**
 * Where the folder is and what it syncs to, behind one ⓘ: the header stays one quiet line, and the
 * long path is a click away, with what people do with it (copy, reveal, open a terminal).
 */
export function FolderInfo({ folder: f }: { folder: FolderStatus }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const api = window.autosync

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => box.current?.contains(e.target as Node) === false && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <span className="folder-info" ref={box}>
      <button type="button" className="info" aria-label="Where this folder is" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="info" />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Where this folder is">
          <div className="pop-label">On {platform.here}</div>
          <div className="pop-value mono">{f.path}</div>
          <div className="pop-acts">
            <button className="btn" onClick={() => api.copyText(f.path)}>
              <Icon name="copy" />
              Copy path
            </button>
            <button className="btn" onClick={() => api.showInFinder(f.id)}>
              <Icon name="folder" />
              Reveal in {platform.fileManager}
            </button>
            <button className="btn" onClick={() => api.openInTerminal(f.id)}>
              {platform.mac ? 'Open in Terminal' : 'Open in Command Prompt'}
            </button>
          </div>
          {f.remoteUrl && (
            <>
              <div className="pop-label">Syncs to</div>
              <div className="pop-value mono">{f.remoteUrl}</div>
              <div className="pop-acts">
                <button className="btn" onClick={() => api.copyText(f.remoteUrl!)}>
                  <Icon name="copy" />
                  Copy URL
                </button>
                {f.webUrl && (
                  <button className="btn" onClick={() => api.openExternal(f.webUrl!)}>
                    <Icon name="ext" />
                    View on GitHub
                  </button>
                )}
              </div>
            </>
          )}
          {f.branch && (
            <>
              <div className="pop-label">Branch</div>
              <div className="pop-value mono">{f.branch} ⇄ origin</div>
            </>
          )}
        </div>
      )}
    </span>
  )
}
