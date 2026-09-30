// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/manager.test.ts; changes: registry folders + pause instead of vault configs, AutoSync status fields (sendAt, retryAt, pendingSince, direction), peek, flush follow-up, PR mode.
import { describe, expect, it } from 'vitest'
import type { FileChange, FolderStatus } from '@shared/types'
import type { RepoPolicy } from './github'
import { createSyncManager, type FolderConfig, type SyncHost, type SyncManager } from './manager'
import type { PassResult } from './sync'

/**
 * The state machine on a FAKE host: no git, no filesystem, no window. Timings are real
 * (`setTimeout`, tiny intervals) rather than faked — the manager interleaves timers with in-flight
 * promises, and driving both by hand ends up testing the driver instead of the code.
 * `guarantees.test.ts` pins serialisation, silence-when-off and the quit flush against real git.
 */

const A: FolderConfig = { id: 'a', path: '/tmp/folder-a', enabled: true }
const NEVER = 60 * 60 * 1000

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: condition never held')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function result(over: Partial<PassResult> = {}, pending: FileChange[] = []): PassResult {
  return {
    attention: null,
    offline: false,
    fetched: true,
    level: true,
    tooBig: [],
    alsoSyncedBy: null,
    facts: { branch: 'main', remoteUrl: 'git@github.com:yaseen/notes.git', pending, ignored: { patterns: [], count: 0 }, conflicts: [] },
    policy: null,
    pr: null,
    ...over,
  }
}

interface Harness {
  manager: SyncManager
  passes: Array<{ root: string; flush: boolean }>
  /** What each pass was told beyond `flush`: the rules it may assume and whether it may send. */
  given: Array<{ policy: RepoPolicy | null; publish: boolean }>
  /** `forgetInFlight` calls, with how many passes had run by then. */
  forgotten: Array<{ root: string; afterPasses: number }>
  /** Every folder status the manager reported, in order (one snapshot per `onChange`). */
  seen: FolderStatus[]
  watching: () => number
  emit: () => void
  peeks: () => number
  status: () => FolderStatus
}

interface Opts extends Partial<Pick<SyncHost, 'quietMs' | 'retryMs' | 'pollMs' | 'wakeCooldownMs' | 'peekMs' | 'ownWritesMs' | 'prQuietMs' | 'prCheckMs'>> {
  /** `n` is the 1-based pass count. */
  pass?: (n: number, onDirection: (d: 'up' | 'down') => void) => Promise<PassResult>
  /** What `git status` finds after a watcher event; by default the event was a real edit. */
  peek?: () => Promise<FileChange[] | null>
}

const EDIT: FileChange[] = [{ status: 'M', path: 'note.md' }]

function harness(opts: Opts = {}): Harness {
  const passes: Array<{ root: string; flush: boolean }> = []
  const given: Harness['given'] = []
  const forgotten: Harness['forgotten'] = []
  const seen: FolderStatus[] = []
  const listeners = new Set<() => void>()
  let peeks = 0
  // Assigned right after the host that closes over it; `onChange` only fires once folders are set.
  let manager: SyncManager
  const host: SyncHost = {
    sync: async (root, o) => {
      passes.push({ root, flush: o.flush })
      given.push({ policy: o.policy, publish: o.publish })
      return opts.pass === undefined ? result() : opts.pass(passes.length, o.onDirection)
    },
    peek: async () => {
      peeks += 1
      return opts.peek === undefined ? EDIT : opts.peek()
    },
    forgetInFlight: async (root) => {
      forgotten.push({ root, afterPasses: passes.length })
    },
    watch: (_root, onEvent) => {
      listeners.add(onEvent)
      return () => listeners.delete(onEvent)
    },
    onChange: () => {
      const f = manager.folders()[0]
      if (f !== undefined) seen.push(f)
    },
    quietMs: opts.quietMs ?? NEVER,
    retryMs: opts.retryMs ?? NEVER,
    pollMs: opts.pollMs ?? NEVER,
    wakeCooldownMs: opts.wakeCooldownMs ?? NEVER,
    peekMs: opts.peekMs ?? 1,
    ownWritesMs: opts.ownWritesMs ?? 0,
    prQuietMs: opts.prQuietMs ?? NEVER,
    prCheckMs: opts.prCheckMs ?? NEVER,
  }
  manager = createSyncManager(host)
  return {
    manager,
    passes,
    given,
    forgotten,
    seen,
    watching: () => listeners.size,
    emit: () => {
      for (const l of [...listeners]) l()
    },
    peeks: () => peeks,
    status: () => manager.folders()[0] as FolderStatus,
  }
}

/** A pass the test releases by hand. */
function gate(): { pass: (n: number) => Promise<PassResult>; release: () => void } {
  let release: () => void = () => {}
  return {
    pass: () =>
      new Promise((resolve) => {
        release = () => resolve(result())
      }),
    release: () => release(),
  }
}

describe('start', () => {
  it('an enabled folder turns on with a pass: syncing, then synced with the pass’s facts', async () => {
    const h = harness()
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    expect(h.passes).toEqual([{ root: A.path, flush: false }])
    expect(h.seen.map((s) => s.state)).toContain('syncing')
    expect(h.status()).toMatchObject({
      id: 'a',
      name: 'folder-a',
      branch: 'main',
      webUrl: 'https://github.com/yaseen/notes',
      pending: [],
      sendAt: null,
      retryAt: null,
      lastSyncedAt: expect.any(Number),
      lastCheckedAt: expect.any(Number),
    })
    expect(h.watching()).toBe(1)
  })

  it('shows the nickname as the name when there is one (D18)', () => {
    const h = harness()
    h.manager.setFolders([{ ...A, enabled: false, alias: 'Work notes' }], false)
    expect(h.status()).toMatchObject({ name: 'Work notes', alias: 'Work notes' })
    h.manager.setFolders([{ ...A, enabled: false }], false)
    expect(h.status()).toMatchObject({ name: 'folder-a', alias: null })
  })

  it('reports which way a pass is moving, and nothing once it is done', async () => {
    const h = harness({
      pass: async (_n, onDirection) => {
        await sleep(1)
        onDirection('down')
        onDirection('up')
        return result()
      },
    })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    const directions = h.seen.filter((s) => s.state === 'syncing').map((s) => s.direction)
    expect(directions.filter((d, i) => d !== directions[i - 1])).toEqual([null, 'down', 'up'])
    expect(h.status().direction).toBeNull()
  })

  it('classifies a host that throws as an error instead of crashing', async () => {
    const h = harness({
      pass: async () => {
        throw new Error('disk went away')
      },
    })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'attention')
    expect(h.status().attention).toEqual({ kind: 'error', detail: 'Error: disk went away' })
  })
})

describe('edits (D3 debounce)', () => {
  it('a real edit marks pending once git status confirms it, and runs exactly one pass after the quiet period', async () => {
    const h = harness({ quietMs: 40 })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')

    const before = Date.now()
    h.emit()
    h.emit()
    h.emit()
    await until(() => h.status().state === 'pending')
    expect(h.status()).toMatchObject({ pending: EDIT, pendingSince: expect.any(Number), sendAt: expect.any(Number) })
    expect(h.status().sendAt).toBeGreaterThanOrEqual(before + 40)
    expect(h.peeks()).toBe(1)
    expect(h.passes).toHaveLength(1)

    await until(() => h.passes.length === 2)
    await until(() => h.status().state === 'synced')
    await sleep(100)
    expect(h.passes).toHaveLength(2)
    expect(h.status().sendAt).toBeNull()
  })

  it('an event git finds nothing behind (an ignored file, an edit undone) keeps the folder synced and cancels the send', async () => {
    let found = EDIT
    const h = harness({ quietMs: 60, peek: async () => found })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.emit()
    await until(() => h.status().state === 'pending')

    found = []
    h.emit()
    await until(() => h.peeks() === 2)
    await sleep(100) // past the send time the first edit armed
    expect(h.status()).toMatchObject({ state: 'synced', pending: [], sendAt: null, pendingSince: null })
    expect(h.passes).toHaveLength(1)
    expect(h.seen.filter((s) => s.state === 'pending')).not.toHaveLength(0)
  })

  it('survives a peek that throws (the folder vanished mid-read): nothing changes, and the next edit still counts', async () => {
    let vanished = true
    const h = harness({
      peek: async () => {
        if (vanished) throw new Error('ENOENT: no such file or directory')
        return EDIT
      },
    })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.emit()
    await until(() => h.peeks() === 1)
    await sleep(20)
    expect(h.status()).toMatchObject({ state: 'synced', pending: [], sendAt: null })

    vanished = false
    h.emit()
    await until(() => h.status().state === 'pending')
  })

  it("ignores AutoSync's own writes: events during a pass, and just after it, never mark pending or run a pass", async () => {
    const g = gate()
    const h = harness({ quietMs: 5, ownWritesMs: 50, pass: (n) => (n === 1 ? g.pass(n) : Promise.resolve(result())) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1)

    for (let i = 0; i < 20; i += 1) h.emit() // the rebase writing the other computer's files
    g.release()
    await until(() => h.status().state === 'synced')
    h.emit() // the watcher reporting them a moment late
    await sleep(100)

    expect(h.passes).toHaveLength(1)
    expect(h.peeks()).toBe(0)
    expect(h.seen.map((s) => s.state)).not.toContain('pending')
    expect(h.status()).toMatchObject({ state: 'synced', sendAt: null })

    h.emit() // a real edit, once the pass has settled
    await until(() => h.status().state === 'pending')
    await until(() => h.passes.length === 2)
  })

  it('an edit made during a pass is caught by the pass’s own closing status, and sent after the quiet period', async () => {
    const h = harness({ quietMs: 20, pass: async (n) => (n === 1 ? result({}, EDIT) : result()) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1 && h.status().state === 'pending')
    expect(h.status().sendAt).toEqual(expect.any(Number))
    await until(() => h.passes.length === 2 && h.status().state === 'synced')
  })

  it('coalesces triggers during a running pass into one follow-up', async () => {
    const g = gate()
    const h = harness({ pass: (n) => (n === 1 ? g.pass(n) : Promise.resolve(result())) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1)

    const settled = Promise.all([h.manager.syncNow('a'), h.manager.syncNow('a'), h.manager.syncNow(null)])
    expect(h.status().state).toBe('syncing')
    g.release()
    await settled
    await sleep(60)
    expect(h.passes).toHaveLength(2)
  })
})

describe('pending bookkeeping', () => {
  it('keeps too-big files out of pending, and pendingSince spans one episode', async () => {
    const big = { path: 'video.mov', bytes: 100 * 1024 * 1024 }
    const note: FileChange = { status: 'M', path: 'note.md' }
    const video: FileChange = { status: 'A', path: 'video.mov' }
    const answers = [result({ offline: true, level: false, tooBig: [big] }, [note, video]), result({ offline: true, level: false, tooBig: [big] }, [note, video]), result({ tooBig: [big] }, [video])]
    const h = harness({ pass: async (n) => answers[n - 1] ?? result() })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1 && !h.status().state.startsWith('sync'))

    expect(h.status()).toMatchObject({ state: 'pending', offline: true, pending: [note], tooBig: [big] })
    const since = h.status().pendingSince
    expect(since).toEqual(expect.any(Number))

    await h.manager.syncNow('a')
    expect(h.status().pendingSince).toBe(since) // same episode

    await h.manager.syncNow('a')
    expect(h.status()).toMatchObject({ state: 'synced', pending: [], pendingSince: null, tooBig: [big] })
  })
})

describe('offline retry', () => {
  it('arms one retry (with its time) after an offline pass, and settles once it succeeds', async () => {
    const h = harness({ retryMs: 30, pass: async (n) => (n === 1 ? result({ offline: true, level: false, fetched: false }) : result()) })
    h.manager.setFolders([A], false)
    await until(() => h.status().offline)
    expect(h.status()).toMatchObject({ state: 'pending', retryAt: expect.any(Number) })

    await until(() => h.status().state === 'synced')
    expect(h.passes).toHaveLength(2)
    expect(h.status().retryAt).toBeNull()
    await sleep(100)
    expect(h.passes).toHaveLength(2)
  })
})

describe('idle poll', () => {
  it('pulls again after `pollMs` while level, without a syncing flash', async () => {
    const h = harness({ pollMs: 20 })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    const afterStart = h.seen.length
    await until(() => h.passes.length >= 3)
    expect(h.seen.slice(afterStart).map((s) => s.state).filter((s) => s !== 'synced')).toEqual([])
    h.manager.setFolders([], false)
  })

  it('keeps polling with conflict copies around, and stops on any other attention or offline', async () => {
    const conflict = result({ attention: { kind: 'conflict', conflicts: [{ original: 'a.md', copy: 'a (conflict Mac-B, 2026-09-27).md' }] } })
    const h1 = harness({ pollMs: 10, pass: async () => conflict })
    h1.manager.setFolders([A], false)
    await until(() => h1.passes.length >= 3)
    expect(h1.status().state).toBe('attention')
    h1.manager.setFolders([], false)

    for (const stop of [result({ attention: { kind: 'auth', detail: 'fatal: Authentication failed' }, level: false }), result({ offline: true, level: false })]) {
      const h = harness({ pollMs: 10, pass: async () => stop })
      h.manager.setFolders([A], false)
      await until(() => h.passes.length === 1 && h.status().state !== 'syncing')
      await sleep(60)
      expect(h.passes).toHaveLength(1)
      h.manager.setFolders([], false)
    }
  })

  it('stands down while edits settle; the edit’s pass re-arms it', async () => {
    const h = harness({ pollMs: 40, quietMs: 80 })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1 && h.status().state === 'synced')
    h.emit()
    await sleep(60) // the poll would have fired by now
    expect(h.passes).toHaveLength(1)
    await until(() => h.passes.length === 2)
    await until(() => h.passes.length === 3)
    h.manager.setFolders([], false)
  })
})

describe('wake (D3)', () => {
  it('pulls on wake once the cooldown has passed, and not inside it', async () => {
    const h = harness({ wakeCooldownMs: NEVER })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.manager.notifyWake()
    await sleep(30)
    expect(h.passes).toHaveLength(1)

    const h2 = harness({ wakeCooldownMs: 0 })
    h2.manager.setFolders([A], false)
    await until(() => h2.status().state === 'synced')
    h2.manager.notifyWake()
    await until(() => h2.passes.length === 2)
  })
})

describe('off means off', () => {
  it('a disabled folder is watched by nothing and synced by nothing, and turning it on pulls', async () => {
    const h = harness({ quietMs: 0, wakeCooldownMs: 0 })
    h.manager.setFolders([{ ...A, enabled: false }], false)
    h.emit()
    h.manager.notifyWake()
    await h.manager.syncNow(null)
    await h.manager.flushForQuit()
    await sleep(30)
    expect(h.passes).toEqual([])
    expect(h.watching()).toBe(0)
    expect(h.status()).toMatchObject({ state: 'off', enabled: false })

    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    expect(h.passes).toHaveLength(1)
  })

  it('pausing stops every folder mid-debounce; resuming pulls', async () => {
    const h = harness({ quietMs: 30 })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.emit()
    h.manager.setFolders([A], true)
    expect(h.status()).toMatchObject({ state: 'off', enabled: true, sendAt: null })
    expect(h.watching()).toBe(0)
    await sleep(80)
    expect(h.passes).toHaveLength(1)

    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 2)
  })

  it('a folder removed mid-pass is forgotten: its result is dropped and nothing follows', async () => {
    const g = gate()
    const h = harness({ quietMs: 5, pass: g.pass })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1)
    h.emit()
    h.manager.setFolders([], false)
    g.release()
    await sleep(60)
    expect(h.manager.folders()).toEqual([])
    expect(h.passes).toHaveLength(1)
  })
})

describe('syncNow', () => {
  it('resolves once the pass is done; null means every active folder', async () => {
    const B: FolderConfig = { id: 'b', path: '/tmp/folder-b', enabled: true }
    const C: FolderConfig = { id: 'c', path: '/tmp/folder-c', enabled: false }
    const h = harness()
    h.manager.setFolders([A, B, C], false)
    await until(() => h.passes.length === 2 && h.manager.folders().every((f) => f.state !== 'syncing'))

    await h.manager.syncNow(null)
    expect(h.passes.map((p) => p.root).slice(2).sort()).toEqual([A.path, B.path])
    expect(h.manager.folders().map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('flushForQuit', () => {
  it('cancels a waiting debounce and lands one flush pass', async () => {
    const h = harness()
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.emit()
    await until(() => h.status().sendAt !== null)

    await h.manager.flushForQuit()

    expect(h.passes).toEqual([
      { root: A.path, flush: false },
      { root: A.path, flush: true },
    ])
    expect(h.watching()).toBe(0)
  })

  it('joins a pass already running, and its follow-up is the flush', async () => {
    const g = gate()
    const h = harness({ pass: (n) => (n === 1 ? g.pass(n) : Promise.resolve(result())) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1)
    void h.manager.syncNow('a') // a normal follow-up is queued…
    const flushed = h.manager.flushForQuit() // …and the quit upgrades it
    g.release()
    await flushed
    expect(h.passes.map((p) => p.flush)).toEqual([false, true])
  })
})

describe('PR mode (D22, D24, D26)', () => {
  const RULES: RepoPolicy = { defaultBranch: 'main', requiresPr: true }
  const PR = { number: 1, url: 'https://github.com/yaseen/notes/pull/1' }

  it('hands every pass the last known rules; only a successful read replaces them, and off forgets them', async () => {
    const answers = [result({ policy: RULES }), result({ policy: null })]
    const h = harness({ pass: async (n) => answers[n - 1] ?? result() })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    await h.manager.syncNow('a')
    await h.manager.syncNow('a')
    expect(h.given.map((g) => g.policy)).toEqual([null, RULES, RULES])
    expect(h.status().publishVia).toBe('pr')

    h.manager.setFolders([{ ...A, enabled: false }], false)
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 4)
    expect(h.given[3]?.policy).toBeNull()
  })

  it('is push mode on any branch but the one the rules govern', async () => {
    const h = harness({ pass: async () => result({ policy: RULES, facts: { branch: 'dev', remoteUrl: null, pending: [], ignored: { patterns: [], count: 0 }, conflicts: [] } }) })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    expect(h.status().publishVia).toBe('push')
  })

  it('quiet passes may not send; every other pass may', async () => {
    const h = harness({ pollMs: 10 })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length >= 2)
    h.manager.setFolders([], false)
    expect(h.given.slice(0, 2).map((g) => g.publish)).toEqual([true, false])
  })

  it('waits `prQuietMs` after an edit, not `quietMs`', async () => {
    const h = harness({ quietMs: 10, pass: async () => result({ policy: RULES }) })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'synced')
    h.emit()
    await until(() => h.status().state === 'pending')
    expect(h.status().sendAt).toBeGreaterThan(Date.now() + 1000)
    await sleep(60)
    expect(h.passes).toHaveLength(1)
  })

  it('while a PR is open: pending with its PR, checked quietly every `prCheckMs`, and no idle poll', async () => {
    const open = result({ level: false, policy: RULES, pr: PR }, EDIT)
    const answers = [open, open, result({ policy: RULES })]
    const h = harness({ prCheckMs: 10, pass: async (n) => answers[n - 1] ?? result() })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 3 && h.status().state === 'synced')
    expect(h.seen.filter((s) => s.state === 'pending').map((s) => s.pr)).toContainEqual(PR)
    expect(h.given.map((g) => g.publish)).toEqual([true, false, false])
    expect(h.status().pr).toBeNull()
    await sleep(40)
    expect(h.passes).toHaveLength(3) // merged and level: back to the (parked) idle poll

    const idle = harness({ pollMs: 5, pass: async () => open })
    idle.manager.setFolders([A], false)
    await sleep(60)
    expect(idle.passes).toHaveLength(1)
    expect(idle.status()).toMatchObject({ state: 'pending', pr: PR })
    idle.manager.setFolders([], false)
  })

  it('an edit while a PR is open does not stop its check: the batch still lands on time', async () => {
    const open = result({ level: false, policy: RULES, pr: PR }, EDIT)
    const answers = [open, open]
    const h = harness({ prCheckMs: 20, pass: async (n) => answers[n - 1] ?? result({ policy: RULES }) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1)
    await sleep(5)
    h.emit()
    await until(() => h.passes.length >= 3)
    h.manager.setFolders([], false)
    expect(h.given.slice(0, 3).map((g) => g.publish)).toEqual([true, false, false])
  })

  it('a quiet pass that landed a batch but could not send it arms the send', async () => {
    const answers = [result({ policy: RULES }), result({ level: false, policy: RULES }, EDIT)]
    const h = harness({ pollMs: 5, prQuietMs: 20, pass: async (n) => answers[n - 1] ?? result({ policy: RULES }) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length >= 3)
    h.manager.setFolders([], false)
    expect(h.given.slice(0, 3).map((g) => g.publish)).toEqual([true, false, true])
  })

  it('resend forgets the closed batch, then runs a normal pass — only while its PR is closed, and only on an active folder', async () => {
    const closed = result({ level: false, policy: RULES, attention: { kind: 'pr-closed', detail: PR.url } }, EDIT)
    const h = harness({ pass: async (n) => (n === 1 ? closed : result({ policy: RULES, pr: PR, level: false }, EDIT)) })
    h.manager.setFolders([A], false)
    await until(() => h.status().state === 'attention')
    await h.manager.resend('a')
    expect(h.forgotten).toEqual([{ root: A.path, afterPasses: 1 }])
    expect(h.passes).toHaveLength(2)
    expect(h.given[1]?.publish).toBe(true)

    await h.manager.resend('a') // its PR is open now: nothing to resend
    h.manager.setFolders([{ ...A, enabled: false }], false)
    await h.manager.resend('a')
    await h.manager.resend('nope')
    expect(h.forgotten).toHaveLength(1)
    expect(h.passes).toHaveLength(2)
  })

  it.each(['pr-closed', 'other-app', 'busy-repo'] as const)('looks again quietly after `%s`: the user settles it outside the app', async (kind) => {
    const h = harness({ pollMs: 10, pass: async () => result({ level: false, attention: { kind } }) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length >= 2)
    h.manager.setFolders([], false)
    expect(h.given[1]?.publish).toBe(false)
  })

  it('does not look again after `no-gh`: that waits for the user', async () => {
    const h = harness({ pollMs: 10, pass: async () => result({ level: false, attention: { kind: 'no-gh', detail: 'GitHub CLI (gh) is not installed.' } }) })
    h.manager.setFolders([A], false)
    await until(() => h.passes.length === 1 && h.status().state === 'attention')
    await sleep(60)
    expect(h.passes).toHaveLength(1)
    h.manager.setFolders([], false)
  })
})
