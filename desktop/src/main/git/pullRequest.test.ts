import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clone, fakeGitHub, pushedRepo as pushedFixture, REAL_GIT_TIMEOUT_MS, remoteHead, shPath, snapshot, type BareRemote, type FakeGitHub, type GitRepo } from './gitFixture'
import type { RepoPolicy } from './github'
import { forgetInFlight, IN_FLIGHT } from './pullRequest'
import { syncFolder, type PassOptions } from './sync'

/**
 * Acceptance proofs for PR publishing (YAZ-2250, catalog S1–S31). Real git against a bare remote;
 * GitHub is `fakeGitHub`, whose `merge` is the repo's Action (a real squash into the bare repo).
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const PR_RULE: RepoPolicy = { defaultBranch: 'main', requiresPr: true }

async function setup(policy: RepoPolicy = PR_RULE): Promise<{ repo: GitRepo; remote: BareRemote; gh: FakeGitHub }> {
  const fixture = await pushedFixture()
  cleanups.push(fixture.cleanup)
  return { ...fixture, gh: await fakeGitHub(fixture.remote, policy) }
}

async function teammate(remote: BareRemote, name = 'Sam'): Promise<GitRepo> {
  const b = await clone(remote, name)
  cleanups.push(b.cleanup)
  return b
}

const pass = (repo: GitRepo, gh: FakeGitHub, opts: Partial<PassOptions> = {}) => syncFolder(repo.root, { host: 'Mac-A', github: gh, ...opts })

const head = (repo: GitRepo) => repo.run(['rev-parse', 'HEAD'])
const inFlight = async (repo: GitRepo) => (await repo.run(['for-each-ref', '--format=%(objectname)', IN_FLIGHT])) || null
const remoteBranches = async (repo: GitRepo, remote: BareRemote) =>
  (await repo.run(['ls-remote', '--heads', remote.url]))
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split('\t')[1]?.replace('refs/heads/', ''))
    .sort()

/** A bare remote that refuses direct pushes to main the way a GitHub ruleset does. */
async function ruleOnMain(remote: BareRemote): Promise<void> {
  const hook = path.join(remote.url, 'hooks', 'pre-receive')
  await writeFile(
    hook,
    '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then\n    echo "remote: error: GH013: Repository rule violations found for refs/heads/main." >&2\n    echo "remote: - Changes must be made through a pull request." >&2\n    exit 1\n  fi\ndone\nexit 0\n',
    { mode: 0o755 },
  )
}

describe('PR publishing (YAZ-2250)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('S2: a repo without a PR rule keeps pushing straight to main', async () => {
    const { repo, remote, gh } = await setup({ defaultBranch: 'main', requiresPr: false })
    await repo.write('a.md', 'a\n')

    const res = await pass(repo, gh)

    expect(res).toMatchObject({ attention: null, level: true, pr: null, policy: { requiresPr: false } })
    expect(await remoteHead(repo, remote)).toBe(await head(repo))
    expect(gh.prs()).toHaveLength(0)
  })

  it('S8: a batch leaves as its own branch and PR, never as a push to main', async () => {
    const { repo, remote, gh } = await setup()
    const mainBefore = await remoteHead(repo, remote)
    await repo.write('a.md', 'a\n')

    const res = await pass(repo, gh)

    const sha = await head(repo)
    expect(await remoteHead(repo, remote)).toBe(mainBefore)
    expect(await remoteBranches(repo, remote)).toEqual([`autosync/${sha.slice(0, 12)}`, 'main'])
    expect(gh.prs()).toEqual([expect.objectContaining({ number: 1, head: `autosync/${sha.slice(0, 12)}`, base: 'main', title: 'sync (Mac-A): a.md', state: 'OPEN' })])
    expect(gh.prs()[0]?.body).toContain('a.md')
    expect(await inFlight(repo)).toBe(sha)
    expect(res).toMatchObject({ attention: null, level: false, pr: { number: 1, url: 'https://github.com/acme/notes/pull/1' }, policy: PR_RULE })
  })

  it('S9: nothing changed means no PR', async () => {
    const { repo, gh } = await setup()
    expect(await pass(repo, gh)).toMatchObject({ attention: null, level: true, pr: null })
    expect(gh.prs()).toHaveLength(0)
  })

  it('S15/S16: while a PR is in flight, new saves are committed but nothing is pushed or opened', async () => {
    const { repo, remote, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await pass(repo, gh)
    const branches = await remoteBranches(repo, remote)
    await repo.write('b.md', 'b\n')

    const res = await pass(repo, gh)

    expect(await repo.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): b.md')
    expect(await repo.run(['status', '--porcelain'])).toBe('')
    expect(await remoteBranches(repo, remote)).toEqual(branches)
    expect(gh.prs()).toHaveLength(1)
    expect(res).toMatchObject({ level: false, pr: { number: 1 } })
  })

  it('S19/S21: a merged batch lands locally; later saves are replayed and go out as the next PR', async () => {
    const { repo, remote, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await pass(repo, gh)
    await repo.write('b.md', 'b\n')
    await pass(repo, gh)
    expect(await gh.merge(1)).toBe(true)

    // A quiet re-check lands the batch but does not send the newer save (D24).
    const landed = await pass(repo, gh, { publish: false })

    expect(landed).toMatchObject({ attention: null, pr: null, level: false })
    expect(await inFlight(repo)).toBeNull()
    expect(await repo.run(['log', '--format=%s', '-3'])).toBe('sync (Mac-A): b.md\nsync (Mac-A): a.md (#1)\nbase')
    expect(gh.prs()).toHaveLength(1)

    const sent = await pass(repo, gh)

    expect(sent).toMatchObject({ pr: { number: 2 } })
    expect(gh.prs()[1]).toMatchObject({ title: 'sync (Mac-A): b.md', state: 'OPEN' })
    expect(await gh.merge(2)).toBe(true)
    expect(await pass(repo, gh)).toMatchObject({ attention: null, pr: null, level: true })
    expect(await remoteHead(repo, remote)).toBe(await head(repo))
    expect(await repo.read('a.md')).toBe('a\n')
    expect(await repo.read('b.md')).toBe('b\n')
  })

  it('S22/S27: two teammates on different files both publish and both receive', async () => {
    const { repo: a, remote, gh } = await setup()
    const b = await teammate(remote)
    await a.write('a.md', 'a\n')
    await b.write('b.md', 'b\n')
    await pass(a, gh)
    await syncFolder(b.root, { host: 'Mac-B', github: gh })
    expect(await gh.merge(1)).toBe(true)
    expect(await gh.merge(2)).toBe(true)

    await pass(a, gh)
    await syncFolder(b.root, { host: 'Mac-B', github: gh })

    expect(await snapshot(a.root)).toEqual(await snapshot(b.root))
    expect(await a.read('b.md')).toBe('b\n')
    expect(await head(a)).toBe(await head(b))
    expect(await remoteHead(a, remote)).toBe(await head(a))
  })

  it('S23: a PR that conflicts with a teammate’s merge is replaced; both versions survive', async () => {
    const { repo: a, remote, gh } = await setup()
    const b = await teammate(remote)
    await a.write('note.md', 'from A\n')
    await b.write('note.md', 'from B\n')
    await syncFolder(b.root, { host: 'Mac-B', github: gh })
    await pass(a, gh)
    expect(await gh.merge(1)).toBe(true) // B's lands first

    const res = await pass(a, gh)

    expect(gh.prs()[1]).toMatchObject({ state: 'CLOSED' })
    expect(gh.prs()[2]).toMatchObject({ state: 'OPEN' })
    expect(res).toMatchObject({ pr: { number: 3 } })
    expect(await remoteBranches(a, remote)).not.toContain(gh.prs()[1]?.head)
    expect(await gh.merge(3)).toBe(true)
    await pass(a, gh)
    const files = await snapshot(a.root)
    expect(files.get('note.md')?.toString()).toBe('from B\n')
    expect([...files.values()].map(String)).toContain('from A\n')
  })

  it('S25: a PR a human closed asks the user and is never re-sent; Send again opens a fresh one', async () => {
    const { repo, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await pass(repo, gh)
    gh.closeByHuman(1)

    const res = await pass(repo, gh)

    expect(res.attention).toEqual({ kind: 'pr-closed', detail: 'https://github.com/acme/notes/pull/1' })
    expect(gh.prs()).toHaveLength(1)
    expect(await pass(repo, gh)).toMatchObject({ attention: { kind: 'pr-closed' } })

    await forgetInFlight(repo.root)
    const again = await pass(repo, gh)

    expect(again).toMatchObject({ attention: null, pr: { number: 2 } })
    expect(await repo.read('a.md')).toBe('a\n')
  })

  it('S11: a pass that died after setting the bookmark pushes and opens the PR next time', async () => {
    const { repo, remote, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'sync (Mac-A): a.md'])
    await repo.run(['update-ref', IN_FLIGHT, 'HEAD'])

    const res = await pass(repo, gh)

    expect(res).toMatchObject({ pr: { number: 1 } })
    expect(await remoteBranches(repo, remote)).toContain(`autosync/${(await head(repo)).slice(0, 12)}`)
  })

  it('S11: a pass that died after the push opens exactly one PR next time', async () => {
    const { repo, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-qm', 'sync (Mac-A): a.md'])
    await repo.run(['update-ref', IN_FLIGHT, 'HEAD'])
    await repo.run(['push', '-q', 'origin', `HEAD:refs/heads/autosync/${(await head(repo)).slice(0, 12)}`])

    await pass(repo, gh)
    await pass(repo, gh)

    expect(gh.prs()).toHaveLength(1)
  })

  it('S12: offline mid-send keeps the bookmark and finishes on the next pass', async () => {
    const { repo, gh } = await setup()
    const hook = path.join(repo.root, '.git', 'hooks', 'pre-push')
    const done = `${shPath(hook)}.done`
    await writeFile(hook, `#!/bin/sh\n[ -f "${done}" ] && exit 0\ntouch "${done}"\necho "fatal: unable to access 'https://github.com/acme/notes/': Could not resolve host: github.com" >&2\nexit 1\n`, { mode: 0o755 })
    await repo.write('a.md', 'a\n')

    expect(await pass(repo, gh)).toMatchObject({ offline: true, pr: null })
    expect(await inFlight(repo)).toBe(await head(repo))
    expect(await pass(repo, gh)).toMatchObject({ offline: false, pr: { number: 1 } })
  })

  it('S10: a batch that nets to nothing opens no PR and leaves the tree alone', async () => {
    const { repo, remote, gh } = await setup()
    await repo.write('note.md', 'changed\n')
    await repo.run(['commit', '-qam', 'edit'])
    await repo.write('note.md', 'line one\n')
    await repo.run(['commit', '-qam', 'undo'])

    const res = await pass(repo, gh)

    expect(gh.prs()).toHaveLength(0)
    expect(res).toMatchObject({ attention: null, pr: null, level: true })
    expect(await head(repo)).toBe(await remoteHead(repo, remote))
    expect(await repo.read('note.md')).toBe('line one\n')
  })

  it('S13: the quit flush in PR mode commits and sends nothing', async () => {
    const { repo, remote, gh } = await setup()
    const before = await remoteBranches(repo, remote)
    await repo.write('a.md', 'a\n')

    await pass(repo, gh, { flush: true, policy: PR_RULE })

    expect(await repo.run(['log', '-1', '--format=%s'])).toBe('sync (Mac-A): a.md')
    expect(await remoteBranches(repo, remote)).toEqual(before)
    expect(gh.prs()).toHaveLength(0)
  })

  it('S20: a bookmark that is no longer under HEAD is dropped without rewriting history', async () => {
    const { repo, gh } = await setup()
    await repo.write('a.md', 'a\n')
    await pass(repo, gh)
    await gh.merge(1)
    await repo.run(['fetch', '-q', 'origin'])
    await repo.run(['reset', '-q', '--hard', 'origin/main'])
    const at = await head(repo)

    expect(await pass(repo, gh)).toMatchObject({ attention: null, pr: null, level: true })
    expect(await inFlight(repo)).toBeNull()
    expect(await head(repo)).toBe(at)
  })

  it('S31/D29: a side branch in a PR-rule repo is never touched', async () => {
    const { repo, gh } = await setup()
    await repo.run(['switch', '-q', '-c', 'codex/publish-x'])
    await repo.run(['push', '-q', '-u', 'origin', 'HEAD'])
    const at = await head(repo)
    await repo.write('a.md', 'a\n')

    const res = await pass(repo, gh)

    expect(res.attention).toEqual({ kind: 'busy-repo', detail: 'side-branch' })
    expect(await head(repo)).toBe(at)
    expect(await repo.run(['status', '--porcelain'])).toBe('?? a.md')
  })

  it('S6: a push refused by a new rule switches to a PR in the same pass', async () => {
    const { repo, remote, gh } = await setup()
    await ruleOnMain(remote)
    await repo.write('a.md', 'a\n')

    const res = await pass(repo, gh, { policy: { defaultBranch: 'main', requiresPr: false } })

    expect(res).toMatchObject({ attention: null, pr: { number: 1 }, policy: PR_RULE })
  })

  it('S3: no gh and a push refused by a rule asks for gh', async () => {
    const { repo, remote, gh } = await setup()
    await ruleOnMain(remote)
    gh.failWith({ kind: 'no-gh', detail: 'gh: command not found' })
    await repo.write('a.md', 'a\n')

    const res = await pass(repo, gh)

    expect(res.attention).toMatchObject({ kind: 'no-gh' })
    expect(res.policy).toBeNull()
  })

  it('S4: offline while reading the rules is not cached', async () => {
    const { repo, gh } = await setup()
    gh.failWith({ kind: 'offline', detail: 'error connecting to api.github.com' })
    expect((await pass(repo, gh)).policy).toBeNull()
  })

  it('S29/D27: the Docs sync switch on means zero writes until it is off', async () => {
    const { repo, gh } = await setup({ defaultBranch: 'main', requiresPr: false })
    await repo.write('.gitignore', '.yaseendocs/\n')
    await repo.write('.yaseendocs/github.json', '{"enabled": true}')
    await repo.write('a.md', 'a\n')
    const at = await head(repo)

    expect((await pass(repo, gh)).attention).toEqual({ kind: 'other-app', detail: 'Docs' })
    expect(await head(repo)).toBe(at)

    await repo.write('.yaseendocs/github.json', '{"enabled": false}')
    expect(await pass(repo, gh)).toMatchObject({ attention: null, level: true })
  })
})
