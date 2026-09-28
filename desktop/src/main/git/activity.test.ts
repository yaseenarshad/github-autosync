import { execFileSync } from 'node:child_process'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ACTIVITY_PAGE_SIZE, classify, readActivity } from './activity'
import { makeGitRepo, REAL_GIT_TIMEOUT_MS, requireGit, type GitRepo } from './gitFixture'

let bin: string
beforeAll(async () => {
  bin = await requireGit()
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function repo(): Promise<GitRepo> {
  const r = await makeGitRepo('Yasin')
  cleanups.push(r.cleanup)
  return r
}

async function commit(r: GitRepo, subject: string, files: Record<string, string> = {}): Promise<void> {
  for (const [rel, content] of Object.entries(files)) await r.write(rel, content)
  await r.run(['add', '-A'])
  await r.run(['commit', '-q', '--allow-empty', '-m', subject])
}

describe('classify', () => {
  it('reads the host out of a sync subject: this computer sent it, any other received', () => {
    expect(classify('sync (Mac-A): a.md', 'Yasin', [], 'Mac-A')).toEqual({ kind: 'sent', host: 'Mac-A' })
    expect(classify('sync (Mac-B)', 'Yasin', [], 'Mac-A')).toEqual({ kind: 'received', host: 'Mac-B' })
  })

  it('calls a commit that ADDS a keep-both copy a conflict, whoever’s subject it carries', () => {
    const files = [{ status: 'A' as const, path: 'a (conflict Mac-A, 2026-09-27).md' }]
    expect(classify('sync (Mac-A): a.md', 'Yasin', files, 'Mac-B')).toEqual({ kind: 'conflict', host: 'Mac-A' })
    // Deleting the copy later is just a sync.
    expect(classify('sync (Mac-B)', 'Yasin', [{ status: 'D', path: files[0]?.path ?? '' }], 'Mac-A').kind).toBe('received')
  })

  it('anything else is a manual commit, credited to its author', () => {
    expect(classify('Fix typo', 'Yasin', [], 'Mac-A')).toEqual({ kind: 'manual', host: 'Yasin' })
    expect(classify('synced notes (by hand)', 'Sam', [], 'Mac-A')).toEqual({ kind: 'manual', host: 'Sam' })
  })
})

describe('readActivity', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('lists commits newest first with their files, renames as renames', async () => {
    const r = await repo()
    await commit(r, 'sync (Mac-A): a.md, b c.md', { 'a.md': 'a\n', 'b c.md': 'b\n' })
    await r.run(['mv', 'a.md', 'renamed.md'])
    await commit(r, 'sync (Mac-B): renamed.md', { 'b c.md': 'b2\n' })
    await commit(r, 'sync (Mac-A): note.md', { 'note (conflict Mac-A, 2026-09-27).md': 'mine\n' })
    await commit(r, 'Tidy up by hand')

    const page = await readActivity(r.root, 'Mac-A')

    expect(page.cursor).toBeNull()
    expect(page.entries.map((e) => [e.kind, e.host, e.subject])).toEqual([
      ['manual', 'Yasin', 'Tidy up by hand'],
      ['conflict', 'Mac-A', 'sync (Mac-A): note.md'],
      ['received', 'Mac-B', 'sync (Mac-B): renamed.md'],
      ['sent', 'Mac-A', 'sync (Mac-A): a.md, b c.md'],
    ])
    expect(page.entries[2]?.files).toEqual([
      { status: 'M', path: 'b c.md' },
      { status: 'R', path: 'renamed.md' },
    ])
    expect(page.entries[3]?.files).toEqual([
      { status: 'A', path: 'a.md' },
      { status: 'A', path: 'b c.md' },
    ])
    expect(page.entries[0]?.files).toEqual([])
    expect(page.entries[0]?.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(Math.abs((page.entries[0]?.time ?? 0) - Date.now())).toBeLessThan(60_000)
  })

  it('pages back through long histories with a cursor', async () => {
    const r = await repo()
    // 205 commits in one git call: fast-import instead of 205 `commit`s.
    const total = ACTIVITY_PAGE_SIZE + 5
    let stream = ''
    for (let i = 1; i <= total; i += 1) {
      const msg = `sync (Mac-A): n${i}.md`
      stream += `commit refs/heads/main\ncommitter Yasin <y@example.invalid> ${1_700_000_000 + i} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\nM 644 inline n${i}.md\ndata 2\n${i % 10}\n\n`
    }
    execFileSync(bin, ['fast-import', '--quiet'], { cwd: r.root, input: stream })

    const first = await readActivity(r.root, 'Mac-A')
    expect(first.entries).toHaveLength(ACTIVITY_PAGE_SIZE)
    expect(first.entries[0]?.subject).toBe(`sync (Mac-A): n${total}.md`)
    expect(first.cursor).toBe(ACTIVITY_PAGE_SIZE)

    const second = await readActivity(r.root, 'Mac-A', first.cursor ?? 0)
    expect(second.entries.map((e) => e.subject)).toEqual([5, 4, 3, 2, 1].map((i) => `sync (Mac-A): n${i}.md`))
    expect(second.cursor).toBeNull()
  })

  it('is an empty page for a repo with no commits, or no git', async () => {
    const r = await repo()
    expect(await readActivity(r.root, 'Mac-A')).toEqual({ entries: [], cursor: null })
    await commit(r, 'first')
    expect(await readActivity(r.root, 'Mac-A', 0, [])).toEqual({ entries: [], cursor: null })
  })
})
