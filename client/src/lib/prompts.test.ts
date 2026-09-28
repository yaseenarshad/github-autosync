import { describe, expect, it } from 'vitest'
import type { Attention } from '@shared/types'
import { makeFolder } from '../test/fixtures'
import { attentionPrompt, loginPrompt, noOriginPrompt, tooBigPrompt } from './prompts'

const folder = makeFolder({ path: '/Users/yasin/Documents/GitHub/notes', remoteUrl: 'git@github.com:yasin/notes.git' })

describe('every folder prompt names the folder and its remote', () => {
  it.each<Attention>([
    { kind: 'conflict', conflicts: [{ original: 'a.md', copy: 'a (conflict MacBook-Pro, 2026-09-27).md' }] },
    { kind: 'auth', detail: 'fatal: Authentication failed' },
    { kind: 'no-git' },
    { kind: 'no-identity' },
    { kind: 'busy-repo', detail: 'rebase' },
    { kind: 'busy-repo', detail: 'detached' },
    { kind: 'error', detail: 'fatal: bad object HEAD' },
  ])('$kind', (attention) => {
    const text = attentionPrompt(folder, attention)
    expect(text).toContain(folder.path)
    expect(text).toContain('git@github.com:yasin/notes.git')
  })

  it('too-big files', () => {
    const text = tooBigPrompt({ ...folder, tooBig: [{ path: 'raw/lesson.mov', bytes: 240 * 1024 ** 2 }] })
    expect(text).toContain(folder.path)
    expect(text).toContain('git@github.com:yasin/notes.git')
    expect(text).toContain('- raw/lesson.mov (240 MB)')
  })
})

it('lists each conflict pair', () => {
  const text = attentionPrompt(folder, {
    kind: 'conflict',
    conflicts: [
      { original: 'a.md', copy: 'a (conflict X, 2026-09-27).md' },
      { original: 'b/c.md', copy: 'b/c (conflict X, 2026-09-27).md' },
    ],
  })
  expect(text).toContain('- a.md  ←  a (conflict X, 2026-09-27).md')
  expect(text).toContain('- b/c.md  ←  b/c (conflict X, 2026-09-27).md')
})

it('carries git detail through for errors and busy state names', () => {
  expect(attentionPrompt(folder, { kind: 'error', detail: 'fatal: bad object HEAD' })).toContain('fatal: bad object HEAD')
  expect(attentionPrompt(folder, { kind: 'busy-repo', detail: 'merge' })).toContain('a merge is in progress')
  expect(attentionPrompt(folder, { kind: 'auth' })).toContain('gh auth setup-git')
})

it('add-folder prompts name the picked path', () => {
  expect(noOriginPrompt('/Users/yasin/local-experiments')).toContain('/Users/yasin/local-experiments')
  expect(loginPrompt('/Users/yasin/private-notes')).toContain('/Users/yasin/private-notes')
})
