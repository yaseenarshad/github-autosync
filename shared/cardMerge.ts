// Copied from yaseen-docs-app@8f343d5a3 (feat/yaz-4946-note-cards) shared/cardMerge.ts (last change c6decefef), with the
// parts it reads of shared/cardLine.ts (last change 175423269), shared/frontmatterSplit.ts, shared/fences.ts,
// shared/pageId.ts and shared/lineEnds.ts; changes: one self-contained file (AutoSync has no card code), only the parts
// the rule reads, `CardBlock` without `open` and `text` is built at once. A change to the card line format in the Docs
// app must be copied here too (YAZ-5654).

/**
 * THE CARD RULE OF SYNC (YAZ-5654, decision 5 on YAZ-5055). A card line is ONE line, so one card answered on two
 * computers is one line changed two ways: git stops the rebase, and AutoSync keeps both pages (a conflict copy). This
 * rule runs BEFORE the page's line merge (`git merge-file` in `resolve.ts`). Each card that BOTH sides changed (by ID)
 * takes, on both sides, the same new line:
 *  - the reviews: the union of both sides' reviews (but a review in the base that one side removed and the other left
 *    as it was stays removed, YAZ-5155), each one ONE time, in time order;
 *  - the marks (`off`, `next`, `notitle`, `fix`, and each part the rule does not know): a three-way result against the
 *    base. A mark that one side changed takes that change; a mark both sides left alone stays as it was;
 *  - the title (`title "…"`, YAZ-5308, YAZ-5309) and each property (YAZ-5349, by its name in any capitals): a three-way
 *    result against the base, by its text. Both sides changed it, each in its own way: theirs;
 *  - the ID and the order of the parts: theirs (it is already everywhere else).
 * A REVIEW (YAZ-5642) is its time, ISO 8601 UTC to the millisecond (`2026-11-16T09:00:00.123Z`), and its rating: two
 * entries are the same review only when the full time text and the rating are the same. A time of any other form (the
 * minute-only `2026-11-16T09:00Z`) is an unknown part: its text is kept, and it is no review.
 * What the rule never does:
 *  - touch a card that only ONE side changed: git's merge takes that side's line;
 *  - touch a card that one side does not hold (moved to a card file, deleted): the page keeps both, as before;
 *  - unite two cards with one ID that the base does not know and whose texts differ;
 *  - read an ID that two cards share on one side.
 * The text of each card and every other line stay as each side has them, byte for byte, with the page's own line end.
 * Pure: no fs.
 */
export function uniteCardLines(base: string | null, theirs: string, mine: string): [string, string] {
  const t = byId(pageCards(theirs))
  const m = byId(pageCards(mine))
  if (t.size === 0 || m.size === 0) return [theirs, mine]
  const b = base === null ? new Map<string, CardBlock>() : byId(pageCards(base))
  const united = new Map<string, CardLine>()
  for (const [id, their] of t) {
    const my = m.get(id)
    if (my === undefined || same(their.line, my.line)) continue
    const was = b.get(id)
    if (was !== undefined && (same(their.line, was.line) || same(my.line, was.line))) continue // one side only: git's
    if (was === undefined && their.text !== my.text) continue // two new cards that took one ID
    united.set(id, uniteLine(was?.line ?? null, their.line, my.line))
  }
  if (united.size === 0) return [theirs, mine]
  const write = (content: string) => rewritePageCards(content, (card) => united.get(cardIdOf(card.line) ?? ''))
  return [write(theirs), write(mine)]
}

/** A cheap first look for `resolve.ts`: a text with no card fence at all is never read further. */
export const mayHoldCards = (text: string): boolean => ANY_CARD_FENCE_RE.test(text)

/** The cards of a page by ID; an ID that two cards share is left out (it is no one card yet). */
function byId(cards: readonly CardBlock[]): Map<string, CardBlock> {
  const out = new Map<string, CardBlock>()
  const twice = new Set<string>()
  for (const card of cards) {
    const id = cardIdOf(card.line)
    if (id === null) continue
    if (out.has(id)) twice.add(id)
    else out.set(id, card)
  }
  for (const id of twice) out.delete(id)
  return out
}

const same = (a: CardLine, b: CardLine): boolean => formatCardLine(a) === formatCardLine(b)

/** What a part is, for the three-way result: the ID, the title, one property by its name, one review, or one mark by its text. */
const keyOf = (p: CardPart): string =>
  p.kind === 'id'
    ? 'id'
    : p.kind === 'title'
      ? 'title'
      : p.kind === 'property'
        ? `property ${keyFold(p.name)}`
        : p.kind === 'review'
          ? `review ${cardReviewKey(p.review)}`
          : p.kind === 'other'
            ? `mark ${p.text}`
            : `mark ${p.kind}`

const marksOf = (line: CardLine | null): Set<string> => new Set((line?.parts ?? []).map(keyOf).filter((k) => k.startsWith('mark ')))

/** One card's line from both sides: the union of the reviews, a three-way result for each mark, the title and each property. */
function uniteLine(base: CardLine | null, theirs: CardLine, mine: CardLine): CardLine {
  const [b, t, m] = [marksOf(base), marksOf(theirs), marksOf(mine)]
  // A mark both sides agree on stays as they have it; else the side that changed it from the base wins.
  const keep = (k: string): boolean => (t.has(k) === m.has(k) ? t.has(k) : t.has(k) === b.has(k) ? m.has(k) : t.has(k))
  const gone = removedReviews(base, theirs, mine)
  let parts = withCardReviews(theirs, cardReviewsOf(mine)).parts.filter((p) =>
    p.kind === 'review' ? !gone.has(cardReviewKey(p.review)) : !keyOf(p).startsWith('mark ') || keep(keyOf(p)),
  )
  // A mark only mine has goes after the part it follows in mine (`next` after the ID, `fix` after the reviews), else first.
  for (let i = 0; i < mine.parts.length; i++) {
    const part = mine.parts[i]
    const k = keyOf(part)
    if (!k.startsWith('mark ') || t.has(k) || !keep(k)) continue
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const before = parts.findIndex((p) => keyOf(p) === keyOf(mine.parts[j]))
      if (before !== -1) {
        at = before + 1
        break
      }
    }
    // The card's own marks go after the head (the ID, the title and the properties) and keep their order: `off`, then
    // `next`, then `notitle`, then `fix`.
    if (rank(part) > 0) while (parts[at]?.kind === 'title' || parts[at]?.kind === 'property') at++
    while (rank(parts[at]) > 0 && rank(parts[at]) < rank(part)) at++
    parts = [...parts.slice(0, at), part, ...parts.slice(at)]
  }
  return uniteProperties(base, theirs, mine, uniteTitle(base, theirs, mine, { parts }))
}

/** A line's properties by name (`keyFold`; the first of two spellings), each with its part. */
function propertiesOf(line: CardLine | null): Map<string, CardPart> {
  const out = new Map<string, CardPart>()
  for (const p of line?.parts ?? []) if (p.kind === 'property' && !out.has(keyFold(p.name))) out.set(keyFold(p.name), p)
  return out
}

/** A part's text as the line writes it (its own bytes when it keeps them). */
const textOf = (p: CardPart | undefined): string | undefined => (p === undefined ? undefined : (formatCardLine({ parts: [p] }) ?? undefined))

/**
 * Each property three ways (YAZ-5349), by its name and its text: the side that changed it from the base (set, a new
 * value, removed) wins; both changed it, each in its own way: theirs. With no base, theirs; a property only mine holds
 * is kept. A rename is a remove and a set: the new name lands where the old one was when theirs left that place alone.
 */
function uniteProperties(base: CardLine | null, theirs: CardLine, mine: CardLine, line: CardLine): CardLine {
  const [b, t, m] = [propertiesOf(base), propertiesOf(theirs), propertiesOf(mine)]
  const mineWins = (k: string): boolean => {
    const [bv, tv, mv] = [textOf(b.get(k)), textOf(t.get(k)), textOf(m.get(k))]
    if (tv === mv) return false
    if (base === null) return tv === undefined
    return tv === bv
  }
  const keys = [...new Set([...t.keys(), ...m.keys()])].filter(mineWins)
  if (keys.length === 0) return line
  let parts = line.parts
  // Removes first, keeping the place of each (a rename puts its new name there).
  const freed: number[] = []
  for (const k of keys) {
    if (m.has(k) || !t.has(k)) continue
    const at = parts.findIndex((p) => keyOf(p) === `property ${k}`)
    freed.push(at)
    parts = parts.filter((p) => keyOf(p) !== `property ${k}`)
  }
  for (const k of keys) {
    const own = m.get(k)
    if (own === undefined) continue
    const at = parts.findIndex((p) => keyOf(p) === `property ${k}`)
    if (at !== -1) {
      parts = parts.flatMap((p, i) => (i === at ? [own] : keyOf(p) === `property ${k}` ? [] : [p]))
      continue
    }
    // A new name: after the property it follows in mine; else where a removed one was; else after the last property, else after the ID and the title.
    const mineAt = mine.parts.indexOf(own)
    let place = -1
    for (let j = mineAt - 1; j >= 0 && place === -1; j--) {
      const prev = mine.parts[j]
      if (prev.kind !== 'property' && prev.kind !== 'title' && prev.kind !== 'id') break
      const found = parts.findIndex((p) => keyOf(p) === keyOf(prev))
      if (found !== -1) place = found + 1
    }
    if (place === -1 && freed.length > 0) place = Math.min(freed.shift()!, parts.length)
    if (place === -1) {
      const last = parts.map((p) => p.kind === 'property').lastIndexOf(true)
      place = last !== -1 ? last + 1 : parts.findIndex((p) => p.kind === 'id') + 1
      while (parts[place]?.kind === 'title') place++
    }
    parts = [...parts.slice(0, place), own, ...parts.slice(place)]
  }
  return { parts }
}

/**
 * The title three ways (YAZ-5309), by its text: the side that changed it from the base wins; both changed it, each to a
 * new one: theirs. Mine's part (its own bytes) takes theirs' place, or comes right after the ID; a title mine removed goes.
 */
function uniteTitle(base: CardLine | null, theirs: CardLine, mine: CardLine, line: CardLine): CardLine {
  const [b, t, m] = [base === null ? null : cardTitleOf(base), cardTitleOf(theirs), cardTitleOf(mine)]
  if (t === m || m === b) return line
  if (t !== b && b !== null) return line
  // Mine changed the title and theirs did not (or the base is not known: then mine is kept only when theirs has none).
  if (b === null && t !== '') return line
  const own = mine.parts.find((p) => p.kind === 'title')
  const at = line.parts.findIndex((p) => p.kind === 'title')
  const rest = line.parts.filter((p) => p.kind !== 'title')
  if (own === undefined) return { parts: rest }
  if (at !== -1) return { parts: line.parts.flatMap((p, i): CardPart[] => (i === at ? [own] : p.kind === 'title' ? [] : [p])) }
  const after = rest.findIndex((p) => p.kind === 'id') + 1
  return { parts: [...rest.slice(0, after), own, ...rest.slice(after)] }
}

/**
 * YAZ-5155: the reviews that stay removed. A review in the base that one side removed (an undo, "Remove review", Reset
 * history) and the other side left as it was (the same seconds, or removed too) stays removed. A review the other side
 * changed (it took its seconds) stays: a change wins over a remove. With no base line for the card: the union.
 */
function removedReviews(base: CardLine | null, theirs: CardLine, mine: CardLine): Set<string> {
  const gone = new Set<string>()
  if (base === null) return gone
  const byKey = (line: CardLine) => new Map(cardReviewsOf(line).map((r) => [cardReviewKey(r), formatCardReview(r)]))
  const [t, m] = [byKey(theirs), byKey(mine)]
  for (const r of cardReviewsOf(base)) {
    const k = cardReviewKey(r)
    const was = formatCardReview(r)
    const [inT, inM] = [t.get(k), m.get(k)]
    if ((inT === undefined && (inM === undefined || inM === was)) || (inM === undefined && inT === was)) gone.add(k)
  }
  return gone
}

const rank = (p: CardPart | undefined): number => (p?.kind === 'off' ? 1 : p?.kind === 'next' ? 2 : p?.kind === 'notitle' ? 3 : p?.kind === 'fix' ? 4 : 0)

// ---------- the card line (from cardLine.ts) ----------
//
//   ```card
//   What is the capital of {{France}}?
//   ---
//   Paris
//   ```
//   <!-- card: WIKI-512, title "Capital", 2026-11-12T14:05:31.204Z good 13s, 2026-11-20T09:00:02.950Z again -->
//
// The line holds the card's ID, its title and properties, each review (its time, its rating, and the answer's seconds
// when known), and the marks `off`, `next`, `notitle` and `fix`. A part the reader does not know is KEPT as its text,
// in its place, and written back; an empty part is skipped.

export type CardRating = 'again' | 'hard' | 'good' | 'easy'

/** One review on a card line. */
export interface CardReview {
  /** ISO 8601 UTC to the millisecond, `2026-11-12T14:05:31.204Z` (YAZ-5642): it sorts as a string. */
  at: string
  rating: CardRating
  /** How long the answer took, in whole seconds, 0 to `CARD_SECONDS_MAX`; absent when not known. */
  seconds?: number
}

const CARD_SECONDS_MAX = 86400

type CardPropertyScalar = string | number | boolean
type CardPropertyValue = CardPropertyScalar | CardPropertyScalar[]

/** One part of a card line, in the order the line holds them. */
export type CardPart =
  | { kind: 'id'; id: string }
  | { kind: 'title'; title: string; raw?: string }
  | { kind: 'property'; name: string; value: CardPropertyValue; raw?: string }
  | { kind: 'review'; review: CardReview }
  | { kind: 'off' }
  | { kind: 'next' }
  | { kind: 'notitle' }
  | { kind: 'fix' }
  | { kind: 'other'; text: string }

/** What a card line holds. A title or property part read in a form the app does not write keeps its text as `raw`. */
export interface CardLine {
  parts: CardPart[]
}

/** `<!-- card: … -->` on one line, any spaces inside the delimiters. */
const LINE_RE = /^<!--[ \t]*card:[ \t]*(.*?)[ \t]*-->$/
/** A review part: a real UTC time to the millisecond (YAZ-5642) and a rating, then ` <n>s` when known. */
const REVIEW_RE = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z)[ \t]+(again|hard|good|easy)(?:[ \t]+(0|[1-9]\d{0,4})s)?$/
/** A title part: `title "…"`, with `\\`, `\"`, `\>` and `&#44;` escapes. */
const TITLE_RE = /^title[ \t]+("(?:[^"\\]|\\.)*")$/
/** A number ID (`shared/pageId.ts`): two to five letters, a dash, a number. */
const NUMBER_ID_RE = /^([A-Za-z]{2,5})-([1-9]\d{0,14})$/
const isNumberId = (value: string): boolean => NUMBER_ID_RE.test(value)
/** A number ID with capital letters. */
const canonicalPageId = (id: string): string => {
  const dash = id.indexOf('-')
  return dash === -1 ? id : id.slice(0, dash).toUpperCase() + id.slice(dash)
}

const isKnownPart = (text: string): boolean => REVIEW_RE.test(text) || text === 'off' || text === 'next' || text === 'notitle' || text === 'fix' || isNumberId(text)

/**
 * The parts of a line's body, split on its commas: a comma inside a quoted text splits nothing. A quote that is never
 * closed never hides the parts after it: from the part it opens in, the known pieces stand alone.
 */
function splitParts(body: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted && ch === '\\' && i + 1 < body.length) i++
    else if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      parts.push(body.slice(start, i).trim())
      start = i + 1
    }
  }
  if (!quoted) return [...parts, body.slice(start).trim()]
  let run: number | null = null
  let at = start
  for (const piece of body.slice(start).split(',')) {
    const end = at + piece.length
    if (isKnownPart(piece.trim())) {
      if (run !== null) parts.push(body.slice(run, at - 1).trim())
      parts.push(piece.trim())
      run = null
    } else run ??= at
    at = end + 1
  }
  if (run !== null) parts.push(body.slice(run).trim())
  return parts
}

const cleanCardTitle = (title: string): string => title.replace(/\s+/g, ' ').trim()

/** A text of the card line as the line writes it, quotes and all (a title, a property's value, a quoted name). */
const quoteText = (text: string): string =>
  `"${text
    .replace(/\r/g, '')
    .replace(/&(?=#(?:44|38);)/g, '&#38;')
    .replace(/,/g, '&#44;')
    .replace(/[\\">\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`))}"`
const unquoteText = (quoted: string): string =>
  quoted.slice(1, -1).replace(/\\(.)|&#(44|38);/g, (_, c: string | undefined, code: string | undefined) => (c === undefined ? (code === '44' ? ',' : '&') : c === 'n' ? '\n' : c))
const titlePart = (title: string): string => `title ${quoteText(title)}`

// Properties: a name, then one or more values (`tags "europe" "capitals"`, `count 3`, `done true`, `tags ["x"]`).
const CARD_LINE_WORDS: ReadonlySet<string> = new Set(['title', 'off', 'next', 'notitle', 'fix'])
const BARE_NAME_RE = /^[\p{L}_][^\s",\\<>]*$/u
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const TOKEN_RE = /[ \t]*("(?:[^"\\]|\\.)*"|[^\s"]+)/y
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

/** A decimal's value as one key, so two forms of one number compare equal. */
function decimalKey(text: string): string {
  const [, sign, whole, frac = '', exp = '0'] = DECIMAL_RE.exec(text)!
  let digits = (whole + frac).replace(/^0+/, '')
  if (digits === '') return '0'
  let e = BigInt(exp) - BigInt(frac.length)
  const kept = digits.replace(/0+$/, '')
  e += BigInt(digits.length - kept.length)
  digits = kept
  return `${sign}${digits}e${e}`
}

/** A bare number token: a number when a double holds it exactly, else its text unchanged. */
function numberValue(text: string): CardPropertyScalar {
  const n = Number(text)
  return Number.isFinite(n) && decimalKey(String(n)) === decimalKey(text) ? n : text
}

const isCardPropertyName = (name: string): boolean => name !== '' && name === name.trim() && !/[\r\n]/.test(name) && !CARD_LINE_WORDS.has(name.toLowerCase())
const formatScalar = (v: CardPropertyScalar): string => (typeof v === 'string' ? quoteText(v) : String(v))
const formatName = (name: string): string => (BARE_NAME_RE.test(name) ? name : quoteText(name))
const formatProperty = (name: string, value: CardPropertyValue): string => {
  if (!Array.isArray(value)) return `${formatName(name)} ${formatScalar(value)}`
  return `${formatName(name)} ${value.length < 2 ? `[${value.map(formatScalar).join(' ')}]` : value.map(formatScalar).join(' ')}`
}

/** The property a part's text holds, or null when it holds none. */
function parseProperty(text: string): { name: string; value: CardPropertyValue } | null {
  const tokens: string[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while (TOKEN_RE.lastIndex < text.length && (m = TOKEN_RE.exec(text)) !== null) tokens.push(m[1])
  if (TOKEN_RE.lastIndex < text.trimEnd().length || tokens.length < 2) return null
  const [head, ...all] = tokens
  const open = all[0]?.startsWith('[') === true
  const close = all.at(-1)?.endsWith(']') === true
  if (open !== close) return null
  const inner = open ? [all[0].slice(1), ...all.slice(1)] : all
  if (open) inner[inner.length - 1] = inner[inner.length - 1].slice(0, -1)
  const rest = inner.filter((t) => t !== '')
  const name = head.startsWith('"') ? unquoteText(head) : BARE_NAME_RE.test(head) ? head : null
  if (name === null || !isCardPropertyName(name)) return null
  const values: CardPropertyScalar[] = []
  for (const t of rest) {
    if (t.startsWith('"')) values.push(unquoteText(t))
    else if (NUMBER_RE.test(t)) values.push(numberValue(t))
    else if (t === 'true' || t === 'false') values.push(t === 'true')
    else return null
  }
  return { name, value: open ? values : values.length === 1 ? values[0] : values }
}

/** The card line `value` holds (one line, trimmed or not), or null when it is no card line. */
export function parseCardLine(value: string): CardLine | null {
  const body = LINE_RE.exec(value.trim())?.[1]
  if (body === undefined || body.includes('-->')) return null
  const parts: CardPart[] = []
  let id = false
  let titled = false
  for (const text of splitParts(body)) {
    if (text === '') continue
    const review = REVIEW_RE.exec(text)
    const seconds = review?.[3] === undefined ? undefined : Number(review[3])
    const title = titled ? null : TITLE_RE.exec(text)
    if (review !== null && (seconds === undefined || seconds <= CARD_SECONDS_MAX))
      parts.push({ kind: 'review', review: seconds === undefined ? { at: review[1], rating: review[2] as CardRating } : { at: review[1], rating: review[2] as CardRating, seconds } })
    else if (title !== null && cleanCardTitle(unquoteText(title[1])) !== '') {
      titled = true
      const clean = cleanCardTitle(unquoteText(title[1]))
      parts.push(text === titlePart(clean) || text.includes(',') ? { kind: 'title', title: clean } : { kind: 'title', title: clean, raw: text })
    } else if (text === 'off') parts.push({ kind: 'off' })
    else if (text === 'next') parts.push({ kind: 'next' })
    else if (text === 'notitle') parts.push({ kind: 'notitle' })
    else if (text === 'fix') parts.push({ kind: 'fix' })
    else if (!id && isNumberId(text)) {
      id = true
      parts.push({ kind: 'id', id: canonicalPageId(text) })
    } else {
      const property = parseProperty(text)
      parts.push(
        property === null ? { kind: 'other', text } : formatProperty(property.name, property.value) === text || text.includes(',') ? { kind: 'property', ...property } : { kind: 'property', ...property, raw: text },
      )
    }
  }
  return { parts }
}

const isCardSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= CARD_SECONDS_MAX

/** A review part as the line writes it: `2026-11-12T14:05:31.204Z good`, and ` 13s` only when its seconds are known. */
const formatCardReview = (r: CardReview): string => (isCardSeconds(r.seconds) ? `${r.at} ${r.rating} ${r.seconds}s` : `${r.at} ${r.rating}`)

/** The key of a review: its full time and its rating (YAZ-5642). Its seconds are no part of it. */
const cardReviewKey = (r: CardReview): string => `${r.at} ${r.rating}`

/** The card line for `line`, or null when it holds no part. */
export function formatCardLine(line: CardLine): string | null {
  const parts = line.parts.map((p) =>
    p.kind === 'id'
      ? p.id
      : p.kind === 'title'
        ? (p.raw ?? titlePart(p.title))
        : p.kind === 'property'
          ? (p.raw ?? formatProperty(p.name, p.value))
          : p.kind === 'review'
            ? formatCardReview(p.review)
            : p.kind === 'other'
              ? p.text
              : p.kind,
  )
  return parts.length === 0 ? null : `<!-- card: ${parts.join(', ')} -->`
}

const EMPTY_CARD_LINE: CardLine = { parts: [] }

export const cardIdOf = (line: CardLine): string | null => line.parts.find((p) => p.kind === 'id')?.id ?? null
export const cardReviewsOf = (line: CardLine): CardReview[] => line.parts.flatMap((p) => (p.kind === 'review' ? [p.review] : []))
const cardTitleOf = (line: CardLine): string => line.parts.find((p) => p.kind === 'title')?.title ?? ''

/**
 * The line with each review of `add` that it does not hold yet (each one ONE time), and its reviews in time order. A
 * review the line holds with no seconds takes them from the same review in `add`. Nothing to add: the same line.
 */
export function withCardReviews(line: CardLine, add: readonly CardReview[]): CardLine {
  const timed = new Map<string, CardReview>()
  for (const r of add) if (isCardSeconds(r.seconds) && !timed.has(cardReviewKey(r))) timed.set(cardReviewKey(r), r)
  let upgraded = false
  const held = cardReviewsOf(line).map((r) => {
    const better = isCardSeconds(r.seconds) ? undefined : timed.get(cardReviewKey(r))
    if (better === undefined) return r
    upgraded = true
    return { ...r, seconds: better.seconds }
  })
  const seen = new Set(held.map(cardReviewKey))
  const fresh = add.filter((r) => !seen.has(cardReviewKey(r)) && (seen.add(cardReviewKey(r)), true)).map((r) => timed.get(cardReviewKey(r)) ?? r)
  if (fresh.length === 0 && !upgraded) return line
  const all = [...held, ...fresh].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  let n = 0
  const parts: CardPart[] = line.parts.map((p) => (p.kind === 'review' ? { kind: 'review', review: all[n++] } : p))
  const last = parts.map((p) => p.kind === 'review').lastIndexOf(true)
  const at = last === -1 ? parts.length : last + 1
  return { parts: [...parts.slice(0, at), ...all.slice(n).map((review): CardPart => ({ kind: 'review', review })), ...parts.slice(at)] }
}

// ---------- cards in a page (from cardLine.ts, fences.ts, frontmatterSplit.ts, lineEnds.ts) ----------

/** A fence that opens a card: three or more backticks or tildes, then `card` and nothing else (a `\r` may end it). */
const CARD_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*card[ \t]*\r?$/
const ANY_CARD_FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*card[ \t]*\r?$/m
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

/** Does `line` close a block opened by `fence`? Same character, at least as long, nothing after it. */
function closesFence(line: string, fence: string): boolean {
  const m = line.includes(fence[0]) ? FENCE_RE.exec(line) : null
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]
}

const fenceOf = (line: string): string | null => (line.includes('`') || line.includes('~') ? (FENCE_RE.exec(line)?.[1] ?? null) : null)

/** One card of a page, by line number (0-based, in the text it was found in). */
export interface CardBlock {
  close: number
  /** The card line's line (`close + 1`), or null when the card has none yet. */
  lineAt: number | null
  indent: string
  /** The card's text: the lines between the fences, without the fence's indent, with `\n` alone. */
  text: string
  line: CardLine
}

/** Every card in `text`, in page order. A code block of any other language is skipped whole. */
function findCards(text: string): CardBlock[] {
  if (!ANY_CARD_FENCE_RE.test(text)) return []
  const lines = text.split('\n')
  const cards: CardBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceOf(lines[i])
    if (fence === null) continue
    const card = CARD_FENCE_RE.exec(lines[i])
    let close = i + 1
    while (close < lines.length && !closesFence(lines[close], fence)) close++
    // A card fence that is never closed is no card yet.
    if (card !== null && close < lines.length) {
      const indent = card[1]
      const next = close + 1 < lines.length ? parseCardLine(lines[close + 1]) : null
      cards.push({
        close,
        lineAt: next === null ? null : close + 1,
        indent,
        text: lines
          .slice(i + 1, close)
          .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
          .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
          .join('\n'),
        line: next ?? EMPTY_CARD_LINE,
      })
    }
    i = close
  }
  return cards
}

/** `text` with the card line of each card `change` names rewritten; undefined (or the card's own line) leaves it. */
function rewriteCardLines(text: string, change: (card: CardBlock) => CardLine | undefined): string {
  const cards = findCards(text)
  if (cards.length === 0) return text
  const lines = text.split('\n')
  for (let n = cards.length - 1; n >= 0; n--) {
    const card = cards[n]
    const next = change(card)
    if (next === undefined || next === card.line) continue
    const formatted = formatCardLine(next)
    const written = formatted === null ? [] : [card.indent + formatted]
    if (card.lineAt !== null) lines.splice(card.lineAt, 1, ...written)
    else lines.splice(card.close + 1, 0, ...written)
  }
  return lines.join('\n')
}

/** The empty block first, then one with lines (YAZ-5512 S1); a byte order mark belongs to the block. */
const FM_RE = /^(﻿?---\r?\n(?:(?:---|\.\.\.)[ \t]*(?:\r?\n|$)|[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)))/

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const m = FM_RE.exec(markdown)
  if (!m) return { frontmatter: '', body: markdown }
  return { frontmatter: m[1], body: markdown.slice(m[1].length) }
}

const keyFold = (key: string): string => key.trim().toLowerCase()

/** The cards of a whole page (a Markdown file's text): those of its body; the properties block is never read for cards. */
export const pageCards = (content: string): CardBlock[] => findCards(splitFrontmatter(content).body)

/** `rewriteCardLines` over a whole page: its properties block is kept byte for byte, and the page keeps its own line end. */
function rewritePageCards(content: string, change: (card: CardBlock) => CardLine | undefined): string {
  return inLineEnds(content, (page) => {
    const { frontmatter, body } = splitFrontmatter(page)
    const next = rewriteCardLines(body, change)
    return next === body ? page : frontmatter + next
  })
}

/** The line end most lines of `text` end with; `\n` for a text with no `\r\n`, and on a tie. */
function lineEndOf(text: string): '\n' | '\r\n' {
  let crlf = 0
  let lf = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    if (at > 0 && text.charCodeAt(at - 1) === 13) crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}

const withLf = (text: string): string => (text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text)

/** `edit` run on `content` with `\n` alone; its result written with the page's own line end. The same result: the same bytes. */
function inLineEnds(content: string, edit: (text: string) => string): string {
  if (!content.includes('\r\n')) return edit(content)
  const text = withLf(content)
  const end = lineEndOf(content)
  const out = edit(text)
  return out === text ? content : end === '\n' ? out : out.replace(/\n/g, '\r\n')
}
