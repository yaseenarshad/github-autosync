import type { AppStatus } from '@shared/types'
import { gitMissingPrompt } from '../lib/prompts'
import { CopyPromptButton } from './CopyPromptButton'
import { Icon } from './Icon'

export function Banners({ status, onResume }: { status: AppStatus; onResume: () => void }) {
  return (
    <>
      {status.gitMissing && (
        <div className="gbanner bad">
          <Icon name="alert" style={{ color: 'var(--bad)' }} />
          <span className="grow">
            <b>Git isn't installed on this computer.</b> AutoSync can't sync anything until it is.
          </span>
          <CopyPromptButton text={gitMissingPrompt()} />
        </div>
      )}
      {status.paused && (
        <div className="gbanner warn">
          <Icon name="pause" style={{ color: 'var(--warn)' }} />
          <span className="grow">
            <b>Syncing is paused.</b> Edits are saved on this Mac and will send when you resume.
          </span>
          <button className="btn" onClick={onResume}>
            <Icon name="play" />
            Resume
          </button>
        </div>
      )}
      {status.folders.some((f) => f.enabled && f.offline) && (
        <div className="gbanner warn">
          <Icon name="wifi-off" style={{ color: 'var(--warn)' }} />
          <span className="grow">
            <b>You're offline.</b> Changes wait here and send on their own when you're back online.
          </span>
        </div>
      )}
    </>
  )
}
