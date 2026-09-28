// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/manager.ts; changes: folders from the registry instead of vault configs, pause, AutoSync FolderStatus, sendAt/retryAt, a pending-list peek, follow-up keeps the strongest mode.
import path from 'node:path'
import type { Attention, FileChange, FolderStatus, OtherApp, SyncState, TooBigFile } from '@shared/types'
import { webUrlOf } from './detect'
import type { PassResult } from './sync'

/**
 * Per-folder sync orchestration (D3): WHEN a pass runs, and what the app is told about it.
 * `sync.ts` owns what a pass does; this module owns the clock, the serialisation and the status.
 *
 * Electron-free by construction — the pass, the watcher and the broadcast arrive through
 * `SyncHost`, so the whole state machine is testable with a fake host.
 *
 * The cadence, in one place so it can be argued with:
 *   - START and ENABLE pull: a folder turns on with a pass.
 *   - EDITS settle first. A watcher event is only a hint: once the burst pauses (`peekMs`, 1 s)
 *     `git status` says whether anything really changed. Real changes mark the folder pending and
 *     start a trailing debounce (`quietMs`, 30 s, the UI counts down to `sendAt`) that every later
 *     save pushes back; a clean look (an ignored file, an edit undone) cancels it.
 *   - AUTOSYNC'S OWN WRITES are not edits: a rebase bringing the other computers' changes in lands
 *     while its pass runs or just after (`ownWritesMs`, 1 s), and those events are dropped. An edit
 *     the user made during a pass is still caught: the pass's closing `git status` finds it.
 *   - OFFLINE waits patiently: exactly one retry (`retryMs`, 2 min, `retryAt`). Wake covers the
 *     common "laptop came back" case sooner than any backoff ladder would.
 *   - WAKE/UNLOCK pull, behind a cooldown, so opening the lid converges without a git storm.
 *   - IDLE pulls: a pass that ended level arms a QUIET pass (`pollMs`, 60 s) — no `syncing` flash —
 *     so a folder nobody is editing still receives the other computers' changes. Never while edits
 *     settle (their pass is coming), never after a failure (the retry, or the user, owns that).
 *     Conflict copies do not stop it: keep-both already settled the conflict.
 *   - QUIT flushes: commit and a short-capped push, no fetch.
 *
 * Two invariants everything else is built to protect:
 *   - ONE pass at a time per folder, and a burst of triggers during a running pass collapses into
 *     exactly ONE follow-up. Concurrent passes would race on `.git/index.lock`; an uncoalesced
 *     queue would turn a 50-file save into 50 commits.
 *   - A DISABLED folder, or any folder while the app is paused, is completely silent: no watcher,
 *     no timers, no git. "Off" has to mean off.
 */

export interface FolderConfig {
  id: string
  path: string
  enabled: boolean
  /** D18 nickname, shown instead of the folder's own name; absent when there is none. */
  alias?: string
}

type PassMode = 'quiet' | 'normal' | 'flush'

/** A follow-up does the most any of its requesters asked for: a quit flush beats a pull, a pull beats a quiet look. */
const MODE_RANK: Record<PassMode, number> = { quiet: 0, normal: 1, flush: 2 }

export interface SyncHost {
  sync(root: string, opts: { flush: boolean; onDirection: (direction: 'up' | 'down') => void }): Promise<PassResult>
  /** The pending list alone; null when it cannot be read. */
  peek(root: string): Promise<FileChange[] | null>
  watch(root: string, onEvent: () => void): () => void
  onChange(): void
  quietMs?: number
  retryMs?: number
  pollMs?: number
  wakeCooldownMs?: number
  peekMs?: number
  ownWritesMs?: number
}

export interface SyncManager {
  /** Reconciles to the registry: starts, stops and forgets folders to match. */
  setFolders(folders: readonly FolderConfig[], paused: boolean): void
  folders(): FolderStatus[]
  /** One folder, or every active one when null; resolves when the passes are done. Inactive folders are a no-op. */
  syncNow(id: string | null): Promise<void>
  notifyWake(): void
  flushForQuit(): Promise<void>
}

const DEFAULT_QUIET_MS = 30_000
const DEFAULT_RETRY_MS = 120_000
const DEFAULT_POLL_MS = 60_000
const DEFAULT_WAKE_COOLDOWN_MS = 10_000
const DEFAULT_PEEK_MS = 1_000
const DEFAULT_OWN_WRITES_MS = 1_000

type Timer = ReturnType<typeof setTimeout>

/** Everyone who asked for a pass while one was running shares this single follow-up. */
interface Follow {
  mode: PassMode
  promise: Promise<void>
  resolve: () => void
}

interface Entry {
  cfg: FolderConfig
  /** Enabled and not paused: watched, timed, synced. */
  active: boolean
  unwatch: (() => void) | null
  busy: boolean
  follow: Follow | null
  /** A non-quiet pass is running. */
  syncing: boolean
  direction: 'up' | 'down' | null
  /** When the last pass finished — the wake cooldown reads this. */
  lastPassAt: number
  debounce: Timer | null
  retry: Timer | null
  poll: Timer | null
  peek: Timer | null
  sendAt: number | null
  retryAt: number | null
  // What the last pass (or peek) found.
  attention: Attention | null
  offline: boolean
  branch: string | null
  remoteUrl: string | null
  pending: FileChange[]
  pendingSince: number | null
  tooBig: TooBigFile[]
  ignored: { patterns: string[]; count: number }
  alsoSyncedBy: OtherApp | null
  lastSyncedAt: number | null
  lastCheckedAt: number | null
}

/** Unref'd: a sync timer must never be the reason the app won't quit — `flushForQuit` is what lands the last change. */
function arm(ms: number, fn: () => void): Timer {
  const timer = setTimeout(fn, ms)
  timer.unref()
  return timer
}

function clearTimers(e: Entry): void {
  for (const timer of [e.debounce, e.retry, e.poll, e.peek]) if (timer !== null) clearTimeout(timer)
  e.debounce = e.retry = e.poll = e.peek = null
  e.sendAt = e.retryAt = null
}

function fresh(cfg: FolderConfig): Entry {
  return {
    cfg,
    active: false,
    unwatch: null,
    busy: false,
    follow: null,
    syncing: false,
    direction: null,
    lastPassAt: 0,
    debounce: null,
    retry: null,
    poll: null,
    peek: null,
    sendAt: null,
    retryAt: null,
    attention: null,
    offline: false,
    branch: null,
    remoteUrl: null,
    pending: [],
    pendingSince: null,
    tooBig: [],
    ignored: { patterns: [], count: 0 },
    alsoSyncedBy: null,
    lastSyncedAt: null,
    lastCheckedAt: null,
  }
}

function stateOf(e: Entry): SyncState {
  if (!e.active) return 'off'
  if (e.syncing) return 'syncing'
  if (e.attention !== null) return 'attention'
  if (e.sendAt !== null || e.offline || e.pending.length > 0) return 'pending'
  return 'synced'
}

function toStatus(e: Entry): FolderStatus {
  return {
    id: e.cfg.id,
    path: e.cfg.path,
    name: e.cfg.alias ?? path.basename(e.cfg.path),
    alias: e.cfg.alias ?? null,
    enabled: e.cfg.enabled,
    state: stateOf(e),
    direction: e.syncing ? e.direction : null,
    attention: e.active ? e.attention : null,
    branch: e.branch,
    remoteUrl: e.remoteUrl,
    webUrl: webUrlOf(e.remoteUrl),
    pending: e.pending,
    tooBig: e.tooBig,
    ignored: e.ignored,
    alsoSyncedBy: e.alsoSyncedBy,
    offline: e.active && e.offline,
    lastSyncedAt: e.lastSyncedAt,
    lastCheckedAt: e.lastCheckedAt,
    pendingSince: e.pendingSince,
    sendAt: e.sendAt,
    retryAt: e.retryAt,
  }
}

/**
 * A held-back file is listed as too big, not as pending — it would otherwise keep the folder
 * "waiting" forever. `pendingSince` marks the start of an episode of unsent changes (D7's
 * one-hour notice) and resets once nothing is left.
 */
function setPending(e: Entry, pending: FileChange[]): void {
  const held = new Set(e.tooBig.map((f) => f.path))
  e.pending = pending.filter((c) => !held.has(c.path))
  if (e.pending.length === 0) e.pendingSince = null
  else e.pendingSince ??= Date.now()
}

function apply(e: Entry, res: PassResult): void {
  const now = Date.now()
  e.tooBig = res.tooBig
  e.attention = res.attention
  e.offline = res.offline
  e.alsoSyncedBy = res.alsoSyncedBy
  if (res.facts !== null) {
    e.branch = res.facts.branch
    e.remoteUrl = res.facts.remoteUrl
    e.ignored = res.facts.ignored
    setPending(e, res.facts.pending)
  }
  if (res.fetched) e.lastCheckedAt = now
  if (res.level) e.lastSyncedAt = now
}

/** A host that throws is classified like any other failure — a rejection would take out a timer's `void` call. */
function crashed(err: unknown): PassResult {
  return { attention: { kind: 'error', detail: String(err) }, offline: false, fetched: false, level: false, tooBig: [], alsoSyncedBy: null, facts: null }
}

export function createSyncManager(host: SyncHost): SyncManager {
  const quietMs = host.quietMs ?? DEFAULT_QUIET_MS
  const retryMs = host.retryMs ?? DEFAULT_RETRY_MS
  const pollMs = host.pollMs ?? DEFAULT_POLL_MS
  const wakeCooldownMs = host.wakeCooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS
  const peekMs = host.peekMs ?? DEFAULT_PEEK_MS
  const ownWritesMs = host.ownWritesMs ?? DEFAULT_OWN_WRITES_MS

  /** Registry order. */
  let entries = new Map<string, Entry>()

  const current = (e: Entry): boolean => entries.get(e.cfg.id) === e

  /** The only way a pass ever starts. Idle → run now; busy → join (or create) the ONE follow-up. */
  function requestPass(e: Entry, mode: PassMode): Promise<void> {
    if (!e.active) return Promise.resolve()
    if (!e.busy) return runPass(e, mode)
    if (e.follow === null) {
      let resolve: () => void = () => {}
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      e.follow = { mode, promise, resolve }
    } else if (MODE_RANK[mode] > MODE_RANK[e.follow.mode]) {
      e.follow.mode = mode
    }
    return e.follow.promise
  }

  /**
   * One pass, start to finish; never rejects. `busy` stays true across the closing `onChange` on
   * purpose — a listener that calls `syncNow` from it must coalesce into the follow-up rather than
   * start a second pass alongside.
   */
  async function runPass(e: Entry, mode: PassMode): Promise<void> {
    e.busy = true
    // The pass commits whatever the debounce was waiting for; an edit made during it re-arms one.
    clearTimers(e)
    if (mode !== 'quiet') {
      e.syncing = true
      e.direction = null
      host.onChange()
    }
    const res = await host
      .sync(e.cfg.path, {
        flush: mode === 'flush',
        onDirection: (direction) => {
          if (mode === 'quiet' || !current(e)) return
          e.direction = direction
          host.onChange()
        },
      })
      .catch(crashed)
    e.syncing = false
    e.direction = null
    e.lastPassAt = Date.now()
    if (current(e)) {
      apply(e, res)
      if (e.active && mode !== 'flush') {
        if (res.offline) {
          e.retryAt = Date.now() + retryMs
          e.retry = arm(retryMs, () => {
            e.retry = e.retryAt = null
            void requestPass(e, 'normal')
          })
        }
        // Level, yet something is pending: the user saved while the pass ran.
        if (res.level && e.pending.length > 0) armDebounce(e)
        else if (res.level) armPoll(e)
      }
      host.onChange()
    }

    const follow = e.follow
    e.follow = null
    e.busy = false
    if (follow === null) return
    if (!e.active || !current(e)) follow.resolve()
    else void runPass(e, follow.mode).then(follow.resolve)
  }

  /** Sends in `quietMs`, pushed back by every call — and the idle poll stands down: the send is coming. */
  function armDebounce(e: Entry): void {
    for (const timer of [e.debounce, e.poll]) if (timer !== null) clearTimeout(timer)
    e.poll = null
    e.sendAt = Date.now() + quietMs
    e.debounce = arm(quietMs, () => {
      e.debounce = e.sendAt = null
      void requestPass(e, 'normal')
    })
  }

  function armPoll(e: Entry): void {
    e.poll = arm(pollMs, () => {
      e.poll = null
      void requestPass(e, 'quiet')
    })
  }

  function onEvent(e: Entry): void {
    if (!e.active || e.busy || Date.now() - e.lastPassAt < ownWritesMs) return
    if (e.debounce !== null) armDebounce(e)
    if (e.peek !== null) clearTimeout(e.peek)
    e.peek = arm(peekMs, () => {
      e.peek = null
      if (e.busy) return
      void host.peek(e.cfg.path).then((pending) => {
        if (pending === null || e.busy || !e.active || !current(e)) return
        setPending(e, pending)
        if (e.pending.length > 0 && e.debounce === null) armDebounce(e)
        if (e.pending.length === 0 && e.debounce !== null) {
          // Undone before it was sent: nothing to send, so back to idling.
          clearTimeout(e.debounce)
          e.debounce = e.sendAt = null
          armPoll(e)
        }
        host.onChange()
      })
    })
  }

  function activate(e: Entry): void {
    e.active = true
    e.unwatch = host.watch(e.cfg.path, () => onEvent(e))
    void requestPass(e, 'normal')
  }

  /** Watcher closed and every timer cleared. A pass already running finishes, but arms nothing and runs no follow-up. */
  function deactivate(e: Entry): void {
    e.active = false
    clearTimers(e)
    e.unwatch?.()
    e.unwatch = null
  }

  return {
    setFolders(folders, paused) {
      const next = new Map<string, Entry>()
      for (const cfg of folders) next.set(cfg.id, entries.get(cfg.id) ?? fresh(cfg))
      for (const [id, e] of entries) if (!next.has(id)) deactivate(e)
      entries = next
      for (const cfg of folders) {
        const e = next.get(cfg.id) as Entry
        e.cfg = cfg
        const wanted = cfg.enabled && !paused
        if (wanted && !e.active) activate(e)
        else if (!wanted && e.active) deactivate(e)
      }
      host.onChange()
    },

    folders() {
      return [...entries.values()].map(toStatus)
    },

    async syncNow(id) {
      const targets = id === null ? [...entries.values()] : [entries.get(id)].filter((e): e is Entry => e !== undefined)
      await Promise.all(targets.map((e) => requestPass(e, 'normal')))
    },

    notifyWake() {
      const now = Date.now()
      for (const e of entries.values()) {
        if (e.busy || now - e.lastPassAt < wakeCooldownMs) continue
        void requestPass(e, 'normal')
      }
    },

    async flushForQuit() {
      const jobs: Array<Promise<void>> = []
      for (const e of entries.values()) {
        if (!e.active) continue
        // No new triggers from here on: the flush is the last pass.
        e.unwatch?.()
        e.unwatch = null
        clearTimers(e)
        jobs.push(requestPass(e, 'flush'))
      }
      await Promise.all(jobs)
    },
  }
}
