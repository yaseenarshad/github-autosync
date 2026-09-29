import { describe, expect, it } from 'vitest'
import { GIT_TIMEOUT_CODE, type GitResult } from './exec'
import { classifyGhFailure, ghCandidates, ghGitHub, type GhRun } from './github'

/** A gh that answers from a script and records every argv it was given. */
function fakeGh(answer: (args: string[]) => GitResult | null): { run: GhRun; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    run: async (args) => {
      calls.push(args)
      return answer(args)
    },
  }
}

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr: string, code = 1): GitResult => ({ code, stdout: '', stderr })
const REMOTE = 'git@github.com:acme/notes.git'

describe('ghCandidates (D28)', () => {
  it('lists explicit paths per OS', () => {
    expect(ghCandidates('darwin')).toEqual(['/opt/homebrew/bin/gh', '/usr/local/bin/gh'])
    expect(ghCandidates('linux')).toEqual(['/usr/bin/gh', '/usr/local/bin/gh'])
    expect(ghCandidates('win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toHaveLength(2)
    expect(ghCandidates('win32', {})).toEqual([])
  })
})

describe('ghGitHub', () => {
  it('is null for a remote that is not GitHub', () => {
    expect(ghGitHub(fakeGh(() => null).run).repo('/tmp/bare.git')).toBeNull()
  })

  it('reads the default branch, then whether its rules include a pull_request rule', async () => {
    const gh = fakeGh((args) => (args[1] === 'repos/acme/notes' ? ok('main\n') : ok('[{"type":"deletion"},{"type":"pull_request","parameters":{}}]')))
    expect(await ghGitHub(gh.run).repo(REMOTE)?.policy()).toEqual({ ok: true, value: { defaultBranch: 'main', requiresPr: true } })
    expect(gh.calls).toEqual([
      ['api', 'repos/acme/notes', '--jq', '.default_branch'],
      ['api', 'repos/acme/notes/rules/branches/main'],
    ])

    const none = fakeGh((args) => (args[1] === 'repos/acme/notes' ? ok('trunk\n') : ok('[]')))
    expect(await ghGitHub(none.run).repo('https://github.com/acme/notes')?.policy()).toEqual({ ok: true, value: { defaultBranch: 'trunk', requiresPr: false } })
  })

  it('finds a PR by its branch, and "no pull requests found" is an answer', async () => {
    const found = fakeGh(() => ok('{"mergeable":"MERGEABLE","number":7,"state":"OPEN","url":"https://github.com/acme/notes/pull/7"}'))
    expect(await ghGitHub(found.run).repo(REMOTE)?.findPr('autosync/abc')).toEqual({ ok: true, value: { number: 7, url: 'https://github.com/acme/notes/pull/7', state: 'OPEN', mergeable: 'MERGEABLE' } })
    expect(found.calls).toEqual([['pr', 'view', 'autosync/abc', '-R', 'acme/notes', '--json', 'number,url,state,mergeable']])

    const none = fakeGh(() => fail('no pull requests found for branch "autosync/abc"'))
    expect(await ghGitHub(none.run).repo(REMOTE)?.findPr('autosync/abc')).toEqual({ ok: true, value: null })
  })

  it('creates a PR and takes its number from the URL gh prints', async () => {
    const gh = fakeGh(() => ok('https://github.com/acme/notes/pull/12\n'))
    const res = await ghGitHub(gh.run).repo(REMOTE)?.createPr({ head: 'autosync/abc', base: 'main', title: 'sync (Mac-A): a.md', body: '- a.md' })
    expect(res).toEqual({ ok: true, value: { number: 12, url: 'https://github.com/acme/notes/pull/12', state: 'OPEN', mergeable: 'UNKNOWN' } })
    expect(gh.calls).toEqual([['pr', 'create', '-R', 'acme/notes', '--base', 'main', '--head', 'autosync/abc', '--title', 'sync (Mac-A): a.md', '--body', '- a.md']])
  })

  it('closes with a comment and deletes the branch', async () => {
    const gh = fakeGh(() => ok(''))
    expect(await ghGitHub(gh.run).repo(REMOTE)?.closePr(3, 'Replaced')).toEqual({ ok: true, value: undefined })
    expect(gh.calls).toEqual([['pr', 'close', '3', '-R', 'acme/notes', '--comment', 'Replaced', '--delete-branch']])
  })

  it('never throws: output it cannot parse is an error', async () => {
    const gh = fakeGh(() => ok('Created!\n'))
    expect(await ghGitHub(gh.run).repo(REMOTE)?.createPr({ head: 'h', base: 'main', title: 't', body: 'b' })).toMatchObject({ ok: false, failure: { kind: 'error' } })
  })
})

describe('classifyGhFailure', () => {
  it.each<[string, GitResult | null, string]>([
    ['not installed', null, 'no-gh'],
    ['logged out', fail('To get started with GitHub CLI, please run:  gh auth login'), 'no-gh'],
    ['no network', fail('error connecting to api.github.com'), 'offline'],
    ['no DNS', fail('dial tcp: lookup api.github.com: no such host'), 'offline'],
    ['killed on timeout', fail('', GIT_TIMEOUT_CODE), 'offline'],
    ['bad token', fail('HTTP 401: Bad credentials (https://api.github.com/graphql)'), 'auth'],
    ['token refused', fail('HTTP 403: Resource not accessible by integration (https://api.github.com/repos/acme/notes)'), 'auth'],
    ['anything else', fail('HTTP 404: Not Found (https://api.github.com/repos/acme/nope)'), 'error'],
  ])('%s → %s', (_name, res, kind) => {
    expect(classifyGhFailure(res).kind).toBe(kind)
  })

  it("keeps gh's own words", () => {
    expect(classifyGhFailure(fail('HTTP 404: Not Found (https://api.github.com/repos/acme/nope)\n'))).toEqual({ kind: 'error', detail: 'HTTP 404: Not Found (https://api.github.com/repos/acme/nope)' })
  })
})
