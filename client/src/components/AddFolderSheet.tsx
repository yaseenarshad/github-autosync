import { useState, type ReactNode } from 'react'
import type { FolderVerdict } from '@shared/types'
import { tildify } from '../lib/format'
import { gitMissingPrompt, loginPrompt, noOriginPrompt } from '../lib/prompts'
import { CopyPromptButton } from './CopyPromptButton'
import { Icon } from './Icon'
import { Sheet } from './Sheets'
import { platform } from '../lib/platform'

/** Native picker, then the main process's verdict (D12); null when the picker was cancelled. */
export async function pickAndCheck(): Promise<FolderVerdict | null> {
  const path = await window.autosync.pickFolder()
  return path === null ? null : window.autosync.checkFolder(path)
}

interface Props {
  initial: FolderVerdict
  home: string | null
  onClose: () => void
  onAdded: (id: string) => void
}

export function AddFolderSheet({ initial, home, onClose, onAdded }: Props) {
  const [verdict, setVerdict] = useState(initial)
  const api = window.autosync

  async function chooseAnother() {
    const next = await pickAndCheck()
    if (next) setVerdict(next)
  }

  async function add() {
    const status = await api.addFolder(verdict.path)
    onClose()
    const added = status.folders.find((f) => f.path === verdict.path)
    if (added) onAdded(added.id)
  }

  return (
    <Sheet
      title="Add a folder to sync"
      onClose={onClose}
      footer={
        <>
          <button className="btn push-left" onClick={chooseAnother}>
            <Icon name="folder" />
            Choose another…
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn blue" disabled={!verdict.ok} onClick={add}>
            Add folder
          </button>
        </>
      }
    >
      <div className="muted">Choose a folder that's already a git repository with a GitHub remote. You do this once on each computer.</div>
      <div className="pick">
        <div className="tr">
          <Icon name="folder" style={{ color: 'var(--muted)' }} />
          <span className="f">{tildify(verdict.path, home)}</span>
        </div>
      </div>
      <Verdict verdict={verdict} home={home} onUseRoot={async (root) => setVerdict(await api.checkFolder(root))} />
    </Sheet>
  )
}

function Verdict({ verdict: v, home, onUseRoot }: { verdict: FolderVerdict; home: string | null; onUseRoot: (root: string) => void }) {
  if (v.ok) {
    const offline = v.offline && " Couldn't reach GitHub right now — it will retry."
    return v.warning ? (
      <Box tone="warn">
        The {v.warning} app also syncs this folder. You can still add it — both will sync. Nothing gets lost, it's just noisier.{offline}
      </Box>
    ) : (
      <Box tone="ok">Git folder with a GitHub remote. Ready to sync.{offline}</Box>
    )
  }
  switch (v.reason) {
    case 'already-added':
      return <Box tone="bad">Already added.</Box>
    case 'not-git':
      return <Box tone="bad">Not a git folder. AutoSync only syncs folders that are already git repositories.</Box>
    case 'not-root': {
      const { root } = v
      return (
        <Box tone="bad">
          This is inside a git folder, not the top of one. Pick {tildify(root, home)} instead.
          <div className="verdict-acts">
            <button className="btn" onClick={() => onUseRoot(root)}>
              <Icon name="folder" />
              Use {tildify(root, home)}
            </button>
          </div>
        </Box>
      )
    }
    case 'no-origin':
      return (
        <Box tone="bad" prompt={noOriginPrompt(v.path)}>
          This is a git folder but it has no GitHub remote (“origin”), so there's nowhere to sync to.
        </Box>
      )
    case 'auth':
      return (
        <Box tone="bad" prompt={loginPrompt(v.path)}>
          GitHub login isn't set up on this computer, so AutoSync can't reach this repo. It's a one-time fix: run “gh auth login” in{' '}
          {platform.terminal}, then try again.
        </Box>
      )
    case 'no-git':
      return (
        <Box tone="bad" prompt={gitMissingPrompt()}>
          Git isn't installed on this computer, so AutoSync can't sync anything yet.
        </Box>
      )
  }
}

function Box({ tone, prompt, children }: { tone: 'ok' | 'warn' | 'bad'; prompt?: string; children: ReactNode }) {
  return (
    <div className={`verdict ${tone}`}>
      <Icon name={tone === 'ok' ? 'check' : 'alert'} />
      <div>
        {children}
        {prompt && (
          <div className="verdict-acts">
            <CopyPromptButton text={prompt} />
          </div>
        )}
      </div>
    </div>
  )
}
