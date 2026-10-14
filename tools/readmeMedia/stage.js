// Shared by the designed pages (window.html, hero.html, dot.html, step.html, …): what they read
// from capture.mjs and the stage pieces they draw. Plain script, no modules: pages load it from
// file://. See stage.css for what the stage is and is not.

/** The page's parameters: JSON in `?p=`, written by capture.mjs. */
const PARAMS = JSON.parse(new URLSearchParams(location.search).get('p') ?? '{}')

/** The app's real menu bar dots (desktop/scripts/render-icons.mjs renders them). */
const TRAY = (state) => `../../desktop/resources/tray/tray-${state}@2x.png`
const ICON = '../../desktop/build/icon.png'
/** The words the menu bar's own menu uses for each state (desktop/src/main/trayState.ts `stateLabel`). */
const WORD = { synced: 'Synced', pending: 'Waiting', syncing: 'Syncing…', attention: 'Needs you' }

const GLYPHS = {
  wifi: '<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="#1c1d22" stroke-width="2.4" stroke-linecap="round"><path d="M2.5 9.2a14 14 0 0 1 19 0"/><path d="M6 12.8a9 9 0 0 1 12 0"/><path d="M9.4 16.3a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19.6" r="1.3" fill="#1c1d22" stroke="none"/></svg>',
  battery: '<svg class="glyph" viewBox="0 0 30 24" style="width:calc(24px * var(--u))" fill="none" stroke="#1c1d22" stroke-width="1.8"><rect x="1.5" y="6" width="23" height="12" rx="3.5"/><rect x="4" y="8.5" width="15" height="7" rx="1.6" fill="#1c1d22" stroke="none"/><path d="M27.3 10v4" stroke-linecap="round" stroke-width="2.2"/></svg>',
  search: '<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="#1c1d22" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
}

/**
 * A menu bar at zoom `u`: `app` and its menus on the left; on the right the app's dot in `dot`
 * (a tray state), the usual glyphs and the clock. Returns the element; `[data-dot]` is the dot.
 */
function menubar({ app = 'GitHub AutoSync', menus = ['File', 'Edit', 'View', 'Window', 'Help'], dot = 'synced', u = 1, clock = 'Tue 13 Oct  9:41', glyphs = true } = {}) {
  const bar = document.createElement('div')
  bar.className = 'menubar'
  bar.style.setProperty('--u', u)
  bar.innerHTML =
    `<b>${app}</b>${menus.map((m) => `<span>${m}</span>`).join('')}` +
    `<span class="right"><span class="tray" data-dot><img alt="" src="${TRAY(dot)}"><img alt=""></span>` +
    (glyphs ? `${GLYPHS.wifi}${GLYPHS.battery}${GLYPHS.search}` : '') +
    `<span class="clock">${clock.replace(/ {2}/g, '&nbsp;&nbsp;')}</span></span>`
  return bar
}

/** Shows `state` on a menu bar dot; `fade` (0…1) cross-fades from what it showed. */
function setDot(tray, state, fade = 1) {
  const [base, top] = tray.querySelectorAll('img')
  if (fade >= 1) {
    base.src = TRAY(state)
    top.style.opacity = 0
  } else {
    top.src = TRAY(state)
    top.style.opacity = fade
  }
}

/** The pointer: an arrow with a yellow halo, its tip at (x, y). */
function pointer(x, y) {
  const el = document.createElement('div')
  el.className = 'pointer'
  el.innerHTML = '<svg viewBox="0 0 34 34" width="40" height="40"><path d="M5 3 L5 27 L11.5 21.2 L16 31 L20.6 28.9 L16.2 19.3 L25 19.3 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>'
  movePointer(el, x, y)
  return el
}
const movePointer = (el, x, y) => Object.assign(el.style, { left: `${x - 6}px`, top: `${y - 4}px` })

/** Keycaps, then an optional word: `keys(['⌘', 'S'], 'Save')`. */
function keys(caps, word = '') {
  const el = document.createElement('div')
  el.className = 'keys'
  el.innerHTML = caps.map((c) => `<span class="key">${c}</span>`).join('') + (word ? `<span class="word">${word}</span>` : '')
  return el
}

/** An absolutely placed element: `place(el, { left, top, width, height })` in px. */
function place(el, box) {
  for (const [k, v] of Object.entries(box)) el.style[k] = typeof v === 'number' ? `${v}px` : v
  return el
}
function add(parent, html, className, box = {}) {
  const el = document.createElement('div')
  if (className) el.className = className
  el.innerHTML = html
  parent.append(place(el, box))
  return el
}

/** 0 before `a`, 1 after `b`, eased in between. */
function ramp(t, a, b) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}
