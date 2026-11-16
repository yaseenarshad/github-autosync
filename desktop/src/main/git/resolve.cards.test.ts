// YAZ-5654: the card rule in keep-both, with real git. The same card answered on two computers is one card line changed
// two ways; before git's own line merge gives up, the rule (`uniteCardLines`) gives both sides the same line and
// `git merge-file` merges the page. Anything that still clashes keeps both, byte for byte as before.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clone, pushedRepo as pushedFixture, REAL_GIT_TIMEOUT_MS, snapshot, type BareRemote, type GitRepo } from './gitFixture'
import { syncFolder } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function twoComputers(files: Record<string, string>): Promise<{ a: GitRepo; b: GitRepo; remote: BareRemote }> {
  const fixture = await pushedFixture(files)
  cleanups.push(fixture.cleanup)
  const b = await clone(fixture.remote, 'Sam')
  cleanups.push(b.cleanup)
  return { a: fixture.repo, b, remote: fixture.remote }
}

/** B commits and pushes first (it is GitHub's side); then A runs a real pass. */
async function race(a: GitRepo, b: GitRepo, theirs: Record<string, string | Buffer>, mine: Record<string, string | Buffer>) {
  for (const [rel, content] of Object.entries(theirs)) await b.write(rel, content)
  await b.run(['add', '-A'])
  await b.run(['commit', '-qm', 'sync (Mac-B)'])
  await b.run(['push', '-q'])
  for (const [rel, content] of Object.entries(mine)) await a.write(rel, content)
  return syncFolder(a.root, { host: 'Mac-A' })
}

/** After every pass: the rebase is over, nothing is left in the folder (no temp file), and A is level with GitHub. */
async function expectClean(a: GitRepo): Promise<void> {
  expect(await a.run(['status', '--porcelain', '--untracked-files=all'])).toBe('')
  expect(existsSync(path.join(a.root, '.git', 'rebase-merge'))).toBe(false)
  expect(await a.run(['ls-files', '--unmerged'])).toBe('')
}

const card = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->\n`
const page = (...cards: string[]) => `---\nid: YAZ-1\n---\n# Spanish words\n\nSome words.\n\n${cards.join('\n')}\nThe end.\n`
const OLD = '2026-11-01T09:00:00.000Z good'
const MAC = '2026-11-16T09:00:00.123Z good 4s'
const PHONE = '2026-11-16T09:00:05.456Z again 7s'
const COPY = /^words \(conflict Mac-A, \d{4}-\d{2}-\d{2}\)\.md$/

describe('keep-both with the card rule (YAZ-5654)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('the same card answered on both sides (9:00:00.123 and 9:00:05.456): one page, both reviews, no copy', async () => {
    const { a, b } = await twoComputers({ 'words.md': page(card('Hola', `YAZ-7, ${OLD}`)) })
    const res = await race(a, b, { 'words.md': page(card('Hola', `YAZ-7, ${OLD}, ${PHONE}`)) }, { 'words.md': page(card('Hola', `YAZ-7, ${OLD}, ${MAC}`)) })

    expect(res.attention).toBeNull()
    expect(res.facts?.conflicts).toEqual([])
    expect(await a.read('words.md')).toBe(page(card('Hola', `YAZ-7, ${OLD}, ${MAC}, ${PHONE}`)))
    expect([...(await snapshot(a.root)).keys()]).toEqual(['words.md'])
    await expectClean(a)
    // The other computer receives the one page.
    await b.run(['pull', '-q', '--rebase'])
    expect(await b.read('words.md')).toBe(page(card('Hola', `YAZ-7, ${OLD}, ${MAC}, ${PHONE}`)))
  })

  it('YAZ-5155: base {R1, R2}, mine {R1} (an undo), theirs {R1, R2, R3}: {R1, R3}, no copy', async () => {
    const R1 = '2026-11-01T09:00:00.000Z good'
    const R2 = '2026-11-05T09:00:00.000Z again'
    const R3 = '2026-11-16T09:00:05.456Z good 4s'
    const { a, b } = await twoComputers({ 'words.md': page(card('Hola', `YAZ-7, ${R1}, ${R2}`)) })
    const res = await race(a, b, { 'words.md': page(card('Hola', `YAZ-7, ${R1}, ${R2}, ${R3}`)) }, { 'words.md': page(card('Hola', `YAZ-7, ${R1}`)) })

    expect(res.facts?.conflicts).toEqual([])
    expect(await a.read('words.md')).toBe(page(card('Hola', `YAZ-7, ${R1}, ${R3}`)))
    await expectClean(a)
  })

  it('two cards answered on both sides, other lines changed apart, a card file, upper-case .MD and Windows line ends: no copy', async () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n')
    const cardFile = (line: string) => `---\nkind: card\ntitle: "Capital"\n---\n${card('Capital of {{France}}\n---\nParis', line)}`
    const base = {
      'words.md': page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', `YAZ-8, ${OLD}`)),
      'cards/Capital.md': cardFile(`YAZ-9, ${OLD}`),
      'Win.MD': crlf(page(card('Gato', `YAZ-10, ${OLD}`))),
    }
    const { a, b } = await twoComputers(base)
    const res = await race(
      a,
      b,
      {
        'words.md': page(card('Hola', `YAZ-7, ${OLD}, ${PHONE}`), card('Adios', `YAZ-8, ${OLD}, ${PHONE}`)).replace('Some words.', 'Some words, edited on B.'),
        'cards/Capital.md': cardFile(`YAZ-9, ${OLD}, ${PHONE}`),
        'Win.MD': crlf(page(card('Gato', `YAZ-10, ${OLD}, ${PHONE}`))),
      },
      {
        'words.md': page(card('Hola', `YAZ-7, ${OLD}, ${MAC}`), card('Adios', `YAZ-8, ${OLD}, ${MAC}, fix`)).replace('The end.', 'The end, edited on A.'),
        'cards/Capital.md': cardFile(`YAZ-9, ${OLD}, ${MAC}`),
        'Win.MD': crlf(page(card('Gato', `YAZ-10, ${OLD}, ${MAC}`))),
      },
    )

    expect(res.facts?.conflicts).toEqual([])
    // `fix` goes after the part it follows on A (its review), as the rule places a mark only one side has.
    expect(await a.read('words.md')).toBe(
      page(card('Hola', `YAZ-7, ${OLD}, ${MAC}, ${PHONE}`), card('Adios', `YAZ-8, ${OLD}, ${MAC}, fix, ${PHONE}`)).replace('Some words.', 'Some words, edited on B.').replace('The end.', 'The end, edited on A.'),
    )
    expect(await a.read('cards/Capital.md')).toBe(cardFile(`YAZ-9, ${OLD}, ${MAC}, ${PHONE}`))
    expect(await a.read('Win.MD')).toBe(crlf(page(card('Gato', `YAZ-10, ${OLD}, ${MAC}, ${PHONE}`))))
    await expectClean(a)
  })

  it('reviews plus a clash in another line: keep both, byte for byte as before', async () => {
    const { a, b } = await twoComputers({ 'words.md': page(card('Hola', `YAZ-7, ${OLD}`)) })
    const theirs = page(card('Hola', `YAZ-7, ${OLD}, ${PHONE}`)).replace('Some words.', 'B’s words.')
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${MAC}`)).replace('Some words.', 'A’s words.')
    const res = await race(a, b, { 'words.md': theirs }, { 'words.md': mine })

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(COPY)
    expect(await a.read('words.md')).toBe(theirs)
    expect(await a.read(copy)).toBe(mine)
    await expectClean(a)
  })

  it('a text clash with no card, a .txt file with card lines, and a card moved out on one side: keep both, byte for byte', async () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', 'YAZ-8'))
    const { a, b } = await twoComputers({ 'plain.md': 'base\n', 'words.txt': base, 'words.md': base })
    const theirs = { 'plain.md': 'from B\n', 'words.txt': base.replace(OLD, `${OLD}, ${PHONE}`), 'words.md': page(card('Adios', 'YAZ-8'), '![[YAZ-7]]\n') }
    const mine = { 'plain.md': 'from A\n', 'words.txt': base.replace(OLD, `${OLD}, ${MAC}`), 'words.md': base.replace(OLD, `${OLD}, ${MAC}`) }
    const res = await race(a, b, theirs, mine)

    const copies = new Map((res.facts?.conflicts ?? []).map((c) => [c.original, c.copy]))
    expect([...copies.keys()].sort()).toEqual(['plain.md', 'words.md', 'words.txt'])
    for (const [rel, copy] of copies) {
      expect(await a.read(rel)).toBe(theirs[rel as keyof typeof theirs])
      expect(await a.read(copy)).toBe(mine[rel as keyof typeof mine])
    }
    await expectClean(a)
  })

  it('a .md file that is not UTF-8: keep both, each side byte for byte', async () => {
    const latin1 = (s: string) => Buffer.from(s, 'latin1')
    const base = page(card('Café', `YAZ-7, ${OLD}`))
    const { a, b } = await twoComputers({ 'words.md': '' })
    await a.write('words.md', latin1(base))
    await a.run(['commit', '-qam', 'latin1'])
    await a.run(['push', '-q'])
    await b.run(['pull', '-q', '--rebase'])
    const theirs = latin1(base.replace(OLD, `${OLD}, ${PHONE}`))
    const mine = latin1(base.replace(OLD, `${OLD}, ${MAC}`))
    const res = await race(a, b, { 'words.md': theirs }, { 'words.md': mine })

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(COPY)
    expect((await readFile(path.join(a.root, 'words.md'))).equals(theirs)).toBe(true)
    expect((await readFile(path.join(a.root, copy))).equals(mine)).toBe(true)
    await expectClean(a)
  })

  it('both sides add the same new page (no base): keep both, as before', async () => {
    const { a, b } = await twoComputers({ 'other.md': 'x\n' })
    const theirs = page(card('Hola', `YAZ-7, ${PHONE}`))
    const mine = page(card('Hola', `YAZ-7, ${MAC}`))
    const res = await race(a, b, { 'words.md': theirs }, { 'words.md': mine })

    const copy = res.facts?.conflicts[0]?.copy ?? ''
    expect(copy).toMatch(COPY)
    expect(await a.read('words.md')).toBe(theirs)
    expect(await a.read(copy)).toBe(mine)
    await expectClean(a)
  })
})
