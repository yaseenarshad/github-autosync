// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/gitFixture.ts; changes: realpath'd temp dirs, `clone` helper, byte snapshot, no storage-worker bundle.
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GIT_CANDIDATES, git, resolveGit } from './exec'
import type { SyncHost } from './manager'
import { peekPending, syncFolder } from './sync'

/**
 * Test fixtures for the git layer. These run the REAL git, not a mock — every interesting
 * behaviour (what a rebase does to a working tree, what a first push writes into `.git/config`) is
 * git's. Every repo is a throwaway under the temp dir and every setting is written LOCALLY, so the
 * developer's own `~/.gitconfig` (identity, signing, default branch) never decides a result.
 * Temp dirs are realpath'd: on macOS `/var` is a link to `/private/var`, and git answers with the
 * real one.
 */

export interface GitRepo {
  root: string
  /** Writes `<root>/<name>`, creating parent directories. */
  write: (name: string, content: string | Buffer) => Promise<void>
  read: (name: string) => Promise<string>
  /** Runs git in this repo and returns trimmed stdout; THROWS on a non-zero exit, so broken setup is never silent. */
  run: (args: string[]) => Promise<string>
  cleanup: () => Promise<void>
}

export interface BareRemote {
  /** A filesystem path, which is a perfectly good git remote URL and needs no network. */
  url: string
  cleanup: () => Promise<void>
}

/**
 * The ceiling for suites that commit, fetch and push against a bare repo on disk: real I/O, not a
 * hang, and vitest's 5 s default is not enough on a cold CI runner.
 */
export const REAL_GIT_TIMEOUT_MS = 20_000

/** The machine's git, or a clear failure — these tests cannot run without one. */
export async function requireGit(): Promise<string> {
  const bin = await resolveGit()
  if (bin === null) throw new Error(`no git found at ${GIT_CANDIDATES.join(' or ')}; the git tests need a real one`)
  return bin
}

/** `maxRetries`: on Windows a just-exited git can hold a handle for a moment (EBUSY/EPERM). */
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5 })

export async function tempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), `autosync-${prefix}-`)))
}

async function runIn(bin: string, root: string, args: string[]): Promise<string> {
  const res = await git(bin, root, args)
  if (res.code !== 0) throw new Error(`git ${args.join(' ')} exited ${res.code} in ${root}: ${res.stderr.trim()}`)
  return res.stdout.trim()
}

function repoAt(bin: string, root: string): GitRepo {
  return {
    root,
    write: async (name, content) => {
      const file = path.join(root, name)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
    },
    read: (name) => readFile(path.join(root, name), 'utf8'),
    run: (args) => runIn(bin, root, args),
    cleanup: () => removeDir(root),
  }
}

async function configure(repo: GitRepo, name: string): Promise<void> {
  await repo.run(['config', 'user.name', name])
  await repo.run(['config', 'user.email', `${name.toLowerCase().replace(/\W+/g, '-')}@example.invalid`])
  // A developer with `commit.gpgsign = true` globally would otherwise fail every commit here.
  await repo.run(['config', 'commit.gpgsign', 'false'])
  // Git for Windows ships `core.autocrlf = true`: the tests compare exact bytes, so no line-ending rewrites.
  await repo.run(['config', 'core.autocrlf', 'false'])
}

/** A temp repo on `main` with a local identity. Zero commits until you make one. */
export async function makeGitRepo(author = 'AutoSync Test'): Promise<GitRepo> {
  const bin = await requireGit()
  const repo = repoAt(bin, await tempDir('repo'))
  await repo.run(['init', '-b', 'main', '.'])
  await configure(repo, author)
  return repo
}

/** A temp bare repo standing in for GitHub. */
export async function makeBareRemote(): Promise<BareRemote> {
  const bin = await requireGit()
  const root = await tempDir('remote')
  await runIn(bin, root, ['init', '--bare', '-b', 'main', '.'])
  return { url: root, cleanup: () => removeDir(root) }
}

export async function wireOrigin(repo: GitRepo, remote: BareRemote): Promise<void> {
  await repo.run(['remote', 'add', 'origin', remote.url])
}

/** Another computer: a fresh clone of `remote` with its own identity. */
export async function clone(remote: BareRemote, author: string): Promise<GitRepo> {
  const bin = await requireGit()
  const repo = repoAt(bin, await tempDir('clone'))
  // `-c` so the first checkout is already byte-exact (see `configure`).
  await runIn(bin, tmpdir(), ['clone', '-q', '-c', 'core.autocrlf=false', remote.url, repo.root])
  await configure(repo, author)
  return repo
}

/** A repo with one commit (`note.md`) pushed to a fresh bare remote, upstream set. */
export async function pushedRepo(files: Record<string, string> = { 'note.md': 'line one\n' }): Promise<{ repo: GitRepo; remote: BareRemote; cleanup: () => Promise<void> }> {
  const repo = await makeGitRepo()
  const remote = await makeBareRemote()
  for (const [rel, content] of Object.entries(files)) await repo.write(rel, content)
  await repo.run(['add', '-A'])
  await repo.run(['commit', '-m', 'base'])
  await wireOrigin(repo, remote)
  await repo.run(['push', '-q', '-u', 'origin', 'HEAD'])
  return { repo, remote, cleanup: async () => void (await Promise.all([repo.cleanup(), remote.cleanup()])) }
}

/** The remote's HEAD sha, read the way another computer would — over the "network". */
export async function remoteHead(repo: GitRepo, remote: BareRemote): Promise<string> {
  return (await repo.run(['ls-remote', remote.url, 'HEAD'])).split('\t')[0] ?? ''
}

/** Every file's bytes under `root`, keyed by repo-relative `/` path, `.git` excluded — the lossless comparator. */
/** A path as a hook script's `sh` wants it: Git for Windows' sh reads `C:/x/y`, not `C:\x\y`. */
export const shPath = (p: string): string => p.split(path.sep).join('/')

export async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(p)
      else out.set(path.relative(root, p).split(path.sep).join('/'), await readFile(p))
    }
  }
  await walk(root)
  return out
}

/**
 * The production host (real passes, real peek) for one computer called `host`, minus the parts a
 * test drives itself: no watcher unless given one, and every clock parked unless a test opts in.
 */
export function gitHost(host: string, over: Partial<SyncHost> = {}): SyncHost {
  const never = 60 * 60 * 1000
  return {
    sync: (root, opts) => syncFolder(root, { ...opts, host }),
    peek: (root) => peekPending(root),
    watch: () => () => undefined,
    onChange: () => undefined,
    quietMs: never,
    retryMs: never,
    pollMs: never,
    wakeCooldownMs: never,
    peekMs: never,
    ...over,
  }
}
