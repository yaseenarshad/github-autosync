// The card rule of sync (YAZ-5654): the same cases as the Docs app's tests of `uniteCardLines`
// (yaseen-docs-app@8f343d5a3 desktop/src/main/cardMerge.test.ts, cardMergeProperties.test.ts, and the merge cases of
// cardMsTimes.test.ts). Changes: the imports, and `cardsOf` reads the card lines here (AutoSync has no index).
import { describe, expect, it } from 'vitest'
import { cardIdOf, cardReviewsOf, pageCards, uniteCardLines, withCardReviews, type CardLine } from './cardMerge'

const splitFrontmatter = (text: string) => {
  const m = /^(---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/.exec(text)
  return m ? { body: text.slice(m[1].length) } : { body: text }
}
const has = (line: CardLine, kind: string) => line.parts.some((p) => p.kind === kind)
const cardsOf = (text: string) => pageCards(text).map(({ line }) => ({ id: cardIdOf(line), off: has(line, 'off'), next: has(line, 'next'), reviews: cardReviewsOf(line) }))

const card = (text: string, line?: string) => `\`\`\`card\n${text}\n\`\`\`\n${line === undefined ? '' : `<!-- card: ${line} -->\n`}`
const page = (...cards: string[]) => `---\nid: YAZ-1\ntitle: Spanish words\n---\n# Spanish words\n\nSome words.\n\n${cards.join('\n')}\nThe end.\n`
const lineOf = (text: string, n = 0) => {
  const c = pageCards(text)[n]
  return c.lineAt === null ? null : splitFrontmatter(text).body.split('\n')[c.lineAt]
}

const OLD = '2026-11-01T09:00:00.000Z good'
const T = '2026-11-13T10:00:00.000Z good 4s'
const M = '2026-11-13T10:05:00.000Z again 7s'

describe('uniteCardLines', () => {
  it('the same card answered on both sides: each side holds the union of the reviews, in time order, and the same line', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
    // Only the card line changed: the rest of each page is byte for byte.
    expect(t.replace(lineOf(t)!, '')).toBe(theirs.replace(lineOf(theirs)!, ''))
  })

  it('a page with no cards, or no card changed on both sides, comes back as the same strings', () => {
    const plain = '---\ntitle: x\n---\nNo cards here.\r\nNone.\n'
    expect(uniteCardLines(plain, plain.replace('None', 'Some'), plain.replace('No ', 'Not '))).toEqual([plain.replace('None', 'Some'), plain.replace('No ', 'Not ')])
    const base = page(card('A', 'YAZ-7'), card('B', 'YAZ-8'))
    const theirs = page(card('A', `YAZ-7, ${T}`), card('B', 'YAZ-8'))
    const mine = page(card('A', 'YAZ-7'), card('B', `YAZ-8, ${M}`))
    const out = uniteCardLines(base, theirs, mine)
    expect(out[0]).toBe(theirs)
    expect(out[1]).toBe(mine)
  })

  it('one side answers and the other edits the card\'s text: the lines are left for git, which can merge them', () => {
    const base = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola\n---\nHello!', `YAZ-7, ${OLD}`))
    const mine = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })

  it('one side edits the text and answers, the other answers: the reviews unite, and the text is left for git', () => {
    const base = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola\n---\nHello!', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(lineOf(t)).toBe(lineOf(m))
    expect(cardsOf(t)[0].reviews.map((r) => r.at)).toEqual(['2026-11-01T09:00:00.000Z', '2026-11-13T10:00:00.000Z', '2026-11-13T10:05:00.000Z'])
    expect(pageCards(t)[0].text).toBe('Hola\n---\nHello!')
    expect(pageCards(m)[0].text).toBe('Hola\n---\nHello')
  })

  it('marks: a three-way result for `off`, `next` and unknown parts such as `fix`; the reviews still unite', () => {
    // Theirs archives the card and answers; mine answers (the answer takes `next` away) and adds `fix`.
    const base = page(card('Hola', `YAZ-7, next, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, off, next, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}, fix`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, off, ${OLD}, ${T}, ${M}, fix -->`)
  })

  it('marks changed on one side only, the reviews on both: the one change stays', () => {
    const base = page(card('Hola', `YAZ-7, off, notitle, future-part, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, notitle, future-part, ${OLD}, ${T}`)) // unarchived, and answered
    const mine = page(card('Hola', `YAZ-7, off, notitle, future-part, ${OLD}, ${M}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, notitle, future-part, ${OLD}, ${T}, ${M} -->`)
  })

  it('marks only, on both sides (no answer): one side puts the card up next, the other archives it', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`))
    const theirs = page(card('Hola', `YAZ-7, next, ${OLD}`))
    const mine = page(card('Hola', `YAZ-7, off, ${OLD}`))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(cardsOf(t)).toEqual([{ id: 'YAZ-7', off: true, next: true, reviews: [{ at: '2026-11-01T09:00:00.000Z', rating: 'good' }] }])
  })

  it('the same review on both sides is one review; a timed copy of it wins', () => {
    const base = page(card('Hola', 'YAZ-7'))
    const [t, m] = uniteCardLines(base, page(card('Hola', 'YAZ-7, 2026-11-13T10:00:00.000Z good')), page(card('Hola', 'YAZ-7, 2026-11-13T10:00:00.000Z good 4s, next')))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe('<!-- card: YAZ-7, 2026-11-13T10:00:00.000Z good 4s, next -->')
  })

  it('a card that moved pages (a convert on one side) is not united: the page with it is left for the line merge', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', 'YAZ-8'))
    const theirs = page(card('Adios', 'YAZ-8'), '![[YAZ-7]]\n')
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`), card('Adios', 'YAZ-8'))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })

  it('the card moved inside the page on one side and was answered on both: it unites by ID', () => {
    const base = page(card('Hola', `YAZ-7, ${OLD}`), card('Adios', 'YAZ-8'))
    const theirs = page(card('Adios', 'YAZ-8'), card('Hola', `YAZ-7, ${OLD}, ${T}`))
    const mine = page(card('Hola', `YAZ-7, ${OLD}, ${M}`), card('Adios', 'YAZ-8'))
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(lineOf(t, 1)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
    expect(lineOf(m, 0)).toBe(`<!-- card: YAZ-7, ${OLD}, ${T}, ${M} -->`)
  })

  it('a card file: one card answered on both sides unites, and its properties stay byte for byte', () => {
    const file = (line: string) => `---\nkind: card\ntitle: "Capital: France"\ncreated: 2026-11-01\n---\n${card('Capital of {{France}}\n---\nParis', line)}`
    const [t, m] = uniteCardLines(file(`YAZ-9, ${OLD}`), file(`YAZ-9, ${OLD}, ${T}`), file(`YAZ-9, ${OLD}, ${M}`))
    expect(t).toBe(m)
    expect(t).toBe(file(`YAZ-9, ${OLD}, ${T}, ${M}`))
  })

  it('a page with Windows line ends keeps them', () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n')
    const [t, m] = uniteCardLines(crlf(page(card('Hola', 'YAZ-7'))), crlf(page(card('Hola', `YAZ-7, ${T}`))), crlf(page(card('Hola', `YAZ-7, ${M}`))))
    expect(t).toBe(m)
    expect(t).toBe(crlf(page(card('Hola', `YAZ-7, ${T}, ${M}`))))
  })

  it('a new card with one ID on both sides (not in the base): united only when the text is the same', () => {
    const base = page()
    const [t1, m1] = uniteCardLines(base, page(card('Hola', `YAZ-7, ${T}`)), page(card('Hola', `YAZ-7, ${M}`)))
    expect(t1).toBe(m1)
    const theirs = page(card('Hola', `YAZ-7, ${T}`))
    const mine = page(card('Gato', `YAZ-7, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
    // No base at all (the page is new on both sides): the same rule.
    const [t2, m2] = uniteCardLines(null, page(card('Hola', `YAZ-7, ${T}`)), page(card('Hola', `YAZ-7, ${M}`)))
    expect(t2).toBe(m2)
    expect(uniteCardLines(null, theirs, mine)).toEqual([theirs, mine])
  })

  it('an ID that two cards share on one side (a copy the sweep has not met) is left alone', () => {
    const base = page(card('Hola', 'YAZ-7'))
    const theirs = page(card('Hola', `YAZ-7, ${T}`), card('Hola', 'YAZ-7'))
    const mine = page(card('Hola', `YAZ-7, ${M}`))
    expect(uniteCardLines(base, theirs, mine)).toEqual([theirs, mine])
  })
})

describe('uniteCardLines: a review removed on one side stays removed (YAZ-5155)', () => {
  const R1 = '2026-11-01T09:00:00.000Z good'
  const R2 = '2026-11-05T09:00:00.000Z again'
  const R3 = '2026-11-13T10:00:00.000Z good 4s'

  it('base {R1, R2}, mine {R1} (an undo), theirs {R1, R2, R3}: {R1, R3}, both ways round', () => {
    const base = page(card('Hola', `YAZ-7, ${R1}, ${R2}`))
    const [t, m] = uniteCardLines(base, page(card('Hola', `YAZ-7, ${R1}, ${R2}, ${R3}`)), page(card('Hola', `YAZ-7, ${R1}`)))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${R1}, ${R3} -->`)
    const [t2, m2] = uniteCardLines(base, page(card('Hola', `YAZ-7, ${R1}`)), page(card('Hola', `YAZ-7, ${R1}, ${R2}, ${R3}`)))
    expect(t2).toBe(m2)
    expect(lineOf(t2)).toBe(`<!-- card: YAZ-7, ${R1}, ${R3} -->`)
  })

  it('both sides remove R2, and one answers: {R1, R3}', () => {
    const [t, m] = uniteCardLines(page(card('Hola', `YAZ-7, ${R1}, ${R2}`)), page(card('Hola', `YAZ-7, ${R1}, ${R3}`)), page(card('Hola', `YAZ-7, off, ${R1}`)))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, off, ${R1}, ${R3} -->`)
  })

  it('one side removes R2, the other changes R2 (its seconds): the changed R2 stays — a change wins over a remove', () => {
    const [t, m] = uniteCardLines(page(card('Hola', `YAZ-7, ${R1}, ${R2}`)), page(card('Hola', `YAZ-7, ${R1}, ${R2} 9s`)), page(card('Hola', `YAZ-7, ${R1}`)))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${R1}, ${R2} 9s -->`)
  })

  it('Reset history on one side, an answer on the other: only the new answer', () => {
    const [t, m] = uniteCardLines(page(card('Hola', `YAZ-7, ${R1}, ${R2}`)), page(card('Hola', 'YAZ-7')), page(card('Hola', `YAZ-7, ${R1}, ${R2}, ${R3}`)))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${R3} -->`)
  })

  it('no base (the page is new on both sides), or the card is not in the base: the union, as before', () => {
    const [t, m] = uniteCardLines(null, page(card('Hola', `YAZ-7, ${R1}, ${R3}`)), page(card('Hola', `YAZ-7, ${R2}`)))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${R1}, ${R2}, ${R3} -->`)
    const [t2, m2] = uniteCardLines(page(), page(card('Hola', `YAZ-7, ${R1}, ${R3}`)), page(card('Hola', `YAZ-7, ${R2}`)))
    expect(t2).toBe(m2)
    expect(lineOf(t2)).toBe(`<!-- card: YAZ-7, ${R1}, ${R2}, ${R3} -->`)
  })
})

// From cardMergeProperties.test.ts (YAZ-5349).

const pcard = (line: string) => `\`\`\`card\nHola\n\`\`\`\n<!-- card: ${line} -->\n`
const ppage = (line: string) => `---\nid: YAZ-1\ntitle: Spanish words\n---\n# Spanish words\n\n${pcard(line)}\nThe end.\n`
const plineOf = (text: string) => {
  const c = pageCards(text)[0]
  return splitFrontmatter(text).body.split('\n')[c.lineAt!]
}
const POLD = '2026-11-01T09:00:00.000Z good'
const A = '2026-11-14T06:01:00.000Z good 9s'
const HEAD = 'YAZ-7, title "Hola"'

/** Both orders (the Mac as theirs, then as mine): the same line on both sides and in both orders, and a second merge changes nothing. */
function both(base: string, mac: string, phone: string): string {
  const out: string[] = []
  for (const [t0, m0] of [
    [mac, phone],
    [phone, mac],
  ]) {
    const [t, m] = uniteCardLines(ppage(base), ppage(t0), ppage(m0))
    expect(t).toBe(m)
    expect(uniteCardLines(ppage(base), t, m)).toEqual([t, m])
    out.push(plineOf(t))
  }
  expect(out[1], 'the Mac as mine').toBe(out[0])
  return out[0]
}

describe('uniteCardLines with card properties (YAZ-5349)', () => {
  it('a property changed on the Mac and an answer on the phone: both stay, in either order', () => {
    expect(both(`${HEAD}, level "A2", ${POLD}`, `${HEAD}, level "B1", ${POLD}`, `${HEAD}, level "A2", ${POLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, level "B1", ${POLD}, ${A} -->`)
  })

  it('a property added on the Mac and Fix later on the phone: both stay; the property sits with the head, `fix` after it', () => {
    expect(both(`${HEAD}, ${POLD}`, `${HEAD}, tags "a" "b", ${POLD}`, `${HEAD}, fix, ${POLD}`)).toBe(`<!-- card: ${HEAD}, tags "a" "b", fix, ${POLD} -->`)
  })

  it('a property removed on the Mac and an answer on the phone: it stays removed', () => {
    expect(both(`${HEAD}, tags ["x"], level "A2", ${POLD}`, `${HEAD}, level "A2", ${POLD}`, `${HEAD}, tags ["x"], level "A2", ${POLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, level "A2", ${POLD}, ${A} -->`)
  })

  it('a property renamed on the Mac and Up next on the phone: the new name, at its place, and `next`', () => {
    expect(both(`${HEAD}, tags "a", level "A2", ${POLD}`, `${HEAD}, topics "a", level "A2", ${POLD}`, `${HEAD}, tags "a", level "A2", next, ${POLD}`)).toBe(`<!-- card: ${HEAD}, topics "a", level "A2", next, ${POLD} -->`)
  })

  it('each side changed another property: each change stays', () => {
    const [t, m] = uniteCardLines(ppage(`${HEAD}, a "1", b "1", ${POLD}`), ppage(`${HEAD}, a "2", b "1", ${POLD}`), ppage(`${HEAD}, a "1", b "3", ${POLD}`))
    expect(t).toBe(m)
    expect(plineOf(t)).toBe(`<!-- card: ${HEAD}, a "2", b "3", ${POLD} -->`)
  })

  it('both sides changed one property, each to a new value: theirs, as for the title', () => {
    const [t, m] = uniteCardLines(ppage(`${HEAD}, level "A2", ${POLD}`), ppage(`${HEAD}, level "B1", ${POLD}`), ppage(`${HEAD}, level "C1", ${POLD}, ${A}`))
    expect(t).toBe(m)
    expect(plineOf(t)).toBe(`<!-- card: ${HEAD}, level "B1", ${POLD}, ${A} -->`)
  })

  it('a property neither side changed keeps its bytes, hand-written form and all', () => {
    expect(both(`${HEAD}, tags  "a"   "b", ${POLD}`, `${HEAD}, tags  "a"   "b", off, ${POLD}`, `${HEAD}, tags  "a"   "b", ${POLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, tags  "a"   "b", off, ${POLD}, ${A} -->`)
  })

  it('a title with &#44; and a title change on the Mac, properties on both: the Mac`s title, the phone`s answer', () => {
    expect(both(`YAZ-7, title "1&#44;000 islands", tags ["x"], ${POLD}`, `YAZ-7, title "1&#44;001 islands", tags ["x"], ${POLD}`, `YAZ-7, title "1&#44;000 islands", tags ["x"], ${POLD}, ${A}`)).toBe(
      `<!-- card: YAZ-7, title "1&#44;001 islands", tags ["x"], ${POLD}, ${A} -->`,
    )
  })
})

// From cardMsTimes.test.ts (YAZ-5642): the merge cases.
const mpage = (body: string) => `# Words\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: ${body} -->\nThe end.\n`
const PHONE = '2026-11-15T15:39:12.345Z'
const MAC = '2026-11-15T15:39:41.802Z'

describe('the merge: two answers in one minute (or one second) on two devices are two reviews', () => {
  const base = mpage('NC-1, 2026-11-03T09:00:00.000Z good')
  it('the phone and the Mac each answer ✕ 29 s apart: the merge keeps both, and the next date counts both', () => {
    const phone = base.replace('good -->', `good, ${PHONE} again -->`)
    const mac = base.replace('good -->', `good, ${MAC} again -->`)
    const [t, m] = uniteCardLines(base, phone, mac)
    expect(t).toBe(m)
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE, MAC])
  })

  it('two answers in ONE second: still two', () => {
    const later = '2026-11-15T15:39:12.346Z'
    const [t] = uniteCardLines(base, base.replace('good -->', `good, ${PHONE} again -->`), base.replace('good -->', `good, ${later} again -->`))
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE, later])
  })

  it('the same review on both sides (identical time and rating) is ONE review', () => {
    const both = base.replace('good -->', `good, ${PHONE} again -->`)
    expect(cardReviewsOf(withCardReviews(pageCards(both)[0].line, cardReviewsOf(pageCards(both)[0].line)))).toHaveLength(2)
    const [t] = uniteCardLines(base, both, both.replace('-->', ', fix -->'))
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE])
  })

  it('a minute-only time is an unknown part: kept as its text, never counted or united as a review', () => {
    const old = '2026-11-15T15:39Z good'
    const withOld = mpage(`NC-1, 2026-11-03T09:00:00.000Z good, ${old}`)
    const [t, m] = uniteCardLines(withOld, withOld.replace('-->', `, ${PHONE} again -->`), withOld.replace('-->', `, ${MAC} again -->`))
    expect(t).toBe(m)
    expect(t).toContain(`<!-- card: NC-1, 2026-11-03T09:00:00.000Z good, ${old}, ${PHONE} again, ${MAC} again -->`)
    expect(cardReviewsOf(pageCards(t)[0].line)).toHaveLength(3)
  })
})
