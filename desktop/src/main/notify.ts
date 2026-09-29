import type { AppStatus, Attention, AttentionKind, FolderStatus } from '@shared/types'

/**
 * D7: when to interrupt the user. Only for things they have to act on — a folder ENTERING
 * attention, or changes that have not reached GitHub for an hour — and never on success. Each
 * fires once per episode: a folder stuck on `auth` for a day says so once, not every pass.
 *
 * Pure: the rules see `AppStatus` snapshots and answer what to show; the Electron `Notification`
 * (and what a click does) belongs to the caller.
 */

export interface Notice {
  folderId: string
  title: string
  body: string
}

export const PENDING_NOTICE_MS = 60 * 60 * 1000

interface Seen {
  kind: AttentionKind | null
  copies: Set<string>
  /** The `pendingSince` already told about. */
  pendingSince: number | null
}

function attentionBody(attention: Attention): string {
  switch (attention.kind) {
    case 'conflict': {
      const pairs = attention.conflicts ?? []
      return pairs.length === 1 ? `${pairs[0]?.original} changed on two computers — both versions kept.` : `${pairs.length} files changed on two computers — both versions kept.`
    }
    case 'auth':
      return 'GitHub turned down the sign-in. Syncing has stopped.'
    case 'no-git':
      return 'git is not installed on this computer. Syncing has stopped.'
    case 'no-identity':
      return 'git needs your name and email before it can save changes.'
    case 'busy-repo':
      if (attention.detail === 'detached') return 'This repo is on a detached HEAD. Syncing is waiting.'
      if (attention.detail === 'side-branch') return 'This repo takes changes through pull requests, and this is not its main branch. Syncing is waiting.'
      return `A ${attention.detail ?? 'git operation'} is in progress. Syncing is waiting.`
    case 'no-gh':
      return 'Needs GitHub CLI to open pull requests. Syncing has stopped.'
    case 'pr-closed':
      return 'Its pull request was closed without merging. Syncing is waiting for you.'
    case 'other-app':
      return `Also synced by the ${attention.detail ?? 'other'} app, so AutoSync leaves it alone.`
    case 'error':
      return `Syncing has stopped: ${attention.detail ?? 'git failed'}`
  }
}

export function createNoticeRules(): (status: AppStatus, now: number) => Notice[] {
  const seen = new Map<string, Seen>()

  function forFolder(f: FolderStatus, now: number): Notice[] {
    const mem = seen.get(f.id) ?? { kind: null, copies: new Set<string>(), pendingSince: null }
    seen.set(f.id, mem)
    const out: Notice[] = []
    const kind = f.attention?.kind ?? null
    const copies = new Set((f.attention?.conflicts ?? []).map((c) => c.copy))
    // Conflicts come back as the same attention with MORE copies: only a new copy is news.
    const grew = kind === 'conflict' && [...copies].some((c) => !mem.copies.has(c))
    if (f.attention !== null && (kind !== mem.kind || grew)) out.push({ folderId: f.id, title: f.name, body: attentionBody(f.attention) })
    mem.kind = kind
    mem.copies = copies
    if (f.pendingSince !== null && now - f.pendingSince >= PENDING_NOTICE_MS && mem.pendingSince !== f.pendingSince) {
      const body = f.pr !== null ? `Pull request #${f.pr.number} has been waiting to merge for over an hour.` : 'Changes on this computer have not reached GitHub for over an hour.'
      out.push({ folderId: f.id, title: f.name, body })
      mem.pendingSince = f.pendingSince
    }
    return out
  }

  return (status, now) => {
    const ids = new Set(status.folders.map((f) => f.id))
    for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id)
    // An off folder (disabled, or the app paused) is the user's choice: nothing to tell them.
    return status.folders.filter((f) => f.state !== 'off').flatMap((f) => forFolder(f, now))
  }
}
