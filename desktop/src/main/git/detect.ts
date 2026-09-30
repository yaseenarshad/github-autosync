// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/detect.ts; changes: rewritten around AutoSync's reads (busy repo, pending, ignored, conflict copies, web URL, Docs/Draw marker, add-folder check).
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ConflictPair, FileChange, FileStatus, FolderVerdict, OtherApp } from '@shared/types'
import { classifyGitFailure, findGit, git, zList } from './exec'

/**
 * Read-only facts about a folder. Every question here has a "no" answer that is NORMAL — no origin,
 * no upstream, nothing ignored — so nothing throws for them. Every call is a read (and
 * `GIT_OPTIONAL_LOCKS=0` keeps even `status` from touching the index), so these are safe on a
 * repo AutoSync is otherwise refusing to write to.
 */

type BusyKind = 'rebase' | 'merge' | 'detached'

export interface RepoState {
  remoteUrl: string | null
  /** Null when detached. */
  branch: string | null
  /** D16: someone (the user, another tool) is mid-operation — AutoSync must not write. */
  busy: BusyKind | null
}

/** The top of a repo: its `.git` is right here (a directory, or a linked worktree's pointer file). */
export const isRepoRoot = (dir: string): boolean => existsSync(path.join(dir, '.git'))

export async function repoState(bin: string, root: string): Promise<RepoState> {
  const remote = await git(bin, root, ['remote', 'get-url', 'origin'])
  // `symbolic-ref` reads HEAD without resolving it, so an unborn branch (zero commits) still has a name.
  const head = await git(bin, root, ['symbolic-ref', '-q', '--short', 'HEAD'])
  const branch = head.code === 0 ? head.stdout.trim() : null
  // `--git-path` rather than `.git/…`: a linked worktree's `.git` is a file pointing elsewhere.
  const [rebaseMerge = '', rebaseApply = '', mergeHead = ''] = (await git(bin, root, ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD'])).stdout.split('\n')
  const present = (p: string) => p !== '' && existsSync(path.resolve(root, p))
  let busy: BusyKind | null = null
  if (present(rebaseMerge) || present(rebaseApply)) busy = 'rebase'
  else if (present(mergeHead)) busy = 'merge'
  else if (branch === null) busy = 'detached'
  return { remoteUrl: remote.code === 0 ? remote.stdout.trim() : null, branch, busy }
}

/** One `status --porcelain` XY code as the four letters the UI speaks. Untracked is an add. */
function porcelainStatus(xy: string): FileStatus {
  if (xy === '??') return 'A'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  if (xy.includes('A') || xy.includes('C')) return 'A'
  return 'M'
}

/** `diff --name-status -z` / `log --name-status -z` tokens: a status, then one path — two for a rename or copy (old, new). */
export function parseNameStatus(tokens: readonly string[]): FileChange[] {
  const out: FileChange[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens[i] ?? ''
    if (code.startsWith('R') || code.startsWith('C')) {
      out.push({ status: code.startsWith('R') ? 'R' : 'A', path: tokens[i + 2] ?? '' })
      i += 2
    } else {
      const letter = code.charAt(0)
      out.push({ status: letter === 'A' || letter === 'D' ? letter : 'M', path: tokens[i + 1] ?? '' })
      i += 1
    }
  }
  return out
}

/**
 * Changes on this computer that are not on GitHub yet: the working tree (untracked files one by
 * one, `-uall`, so a new folder lists its files) plus commits not pushed. The working tree wins a
 * path both mention — it is what the user did last.
 */
export async function readPending(bin: string, root: string): Promise<FileChange[]> {
  const out = new Map<string, FileStatus>()
  const tokens = zList(await git(bin, root, ['status', '--porcelain', '-z', '-uall']))
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i] ?? ''
    const xy = entry.slice(0, 2)
    out.set(entry.slice(3), porcelainStatus(xy))
    if (xy.includes('R') || xy.includes('C')) i += 1 // `-z` puts the rename's old path in the next token
  }
  // Fails without an upstream (never pushed): then there is nothing to compare against.
  for (const change of parseNameStatus(zList(await git(bin, root, ['diff', '--name-status', '-z', '@{u}..HEAD'])))) {
    if (!out.has(change.path)) out.set(change.path, change.status)
  }
  return [...out].map(([p, status]) => ({ status, path: p }))
}

/** How many `.gitignore` patterns the UI lists before it stops. */
const IGNORE_PATTERNS_SHOWN = 20

/** Top-level `.gitignore` patterns and how many entries git currently ignores (a whole ignored folder counts once). */
export async function readIgnored(bin: string, root: string): Promise<{ patterns: string[]; count: number }> {
  const text = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '')
  const patterns = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .slice(0, IGNORE_PATTERNS_SHOWN)
  const count = zList(await git(bin, root, ['status', '--ignored', '--porcelain', '-z'])).filter((e) => e.startsWith('!! ')).length
  return { patterns, count }
}

/**
 * A keep-both copy (D6): `<name> (conflict <host>, <YYYY-MM-DD>)<ext>`, numbered ` 2`, ` 3` inside
 * the parentheses when the day already has one.
 */
const CONFLICT_MARKER = / \(conflict [^,/]+, \d{4}-\d{2}-\d{2}(?: \d+)?\)(?=(?:\.[^/]*)?$)/

export const isConflictCopy = (rel: string): boolean => CONFLICT_MARKER.test(rel)

/**
 * The conflict attention is DERIVED from the tree, never stored: while a copy is tracked the folder
 * says so, on every computer, and deleting the copies anywhere clears it everywhere.
 */
export async function readConflicts(bin: string, root: string): Promise<ConflictPair[]> {
  // The pathspec narrows the listing inside git (`*` crosses `/`); the regex is the real test.
  const tracked = zList(await git(bin, root, ['ls-files', '-z', '--', '*(conflict *']))
  return tracked.filter(isConflictCopy).map((copy) => ({ original: copy.replace(CONFLICT_MARKER, ''), copy }))
}

/** `https://github.com/<owner>/<repo>` for a GitHub origin in any of its spellings (https with or without credentials, scp-style, ssh://), else null. */
export function webUrlOf(remoteUrl: string | null): string | null {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl ?? '')
  return m === null ? null : `https://github.com/${m[1]}/${m[2]}`
}

/** D27: the Docs and Draw apps keep their own per-folder GitHub switch; while it is on a pass stands back (zero writes) and add-folder warns. */
const OTHER_APPS: ReadonlyArray<[OtherApp, string]> = [
  ['Docs', '.yaseendocs/github.json'],
  ['Draw', '.yaseendraw/github.json'],
]

export async function otherApp(root: string): Promise<OtherApp | null> {
  for (const [app, rel] of OTHER_APPS) {
    const raw = await readFile(path.join(root, rel), 'utf8').catch(() => null)
    if (raw === null) continue
    try {
      if ((JSON.parse(raw) as { enabled?: unknown } | null)?.enabled === true) return app
    } catch {
      // A half-written or hand-mangled switch is an off switch.
    }
  }
  return null
}

/** `ls-remote` answers in well under a second on a working connection; this only bounds a dead one. */
const PROBE_TIMEOUT_MS = 15_000

/**
 * D12/D27 add-folder validation, in the order the user should hear about problems: no git at all,
 * not the top of a repo, already listed, no GitHub to sync with, GitHub refusing us. Being offline
 * is not a reason to refuse — the folder syncs once the network is back.
 */
export async function checkFolder(dir: string, known: readonly string[], candidates?: readonly string[]): Promise<FolderVerdict> {
  const bin = await findGit(candidates)
  if (bin === null) return { ok: false, path: dir, reason: 'no-git' }
  if (!isRepoRoot(dir)) {
    const top = await git(bin, dir, ['rev-parse', '--show-toplevel']).catch(() => null)
    // `path.resolve`: git answers `C:/x/y` on Windows; the list compares paths as this OS spells them.
    return top?.code === 0 ? { ok: false, path: dir, reason: 'not-root', root: path.resolve(top.stdout.trim()) } : { ok: false, path: dir, reason: 'not-git' }
  }
  if (known.includes(dir)) return { ok: false, path: dir, reason: 'already-added' }
  if ((await git(bin, dir, ['remote', 'get-url', 'origin'])).code !== 0) return { ok: false, path: dir, reason: 'no-origin' }
  const probe = await git(bin, dir, ['ls-remote', 'origin', 'HEAD'], { timeoutMs: PROBE_TIMEOUT_MS })
  const failure = probe.code === 0 ? null : classifyGitFailure(probe)
  if (failure === 'auth') return { ok: false, path: dir, reason: 'auth' }
  return { ok: true, path: dir, warning: await otherApp(dir), offline: failure === 'offline' }
}
