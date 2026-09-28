// Renders the committed PNGs: the menu bar status dot in every state (resources/tray) and the
// 1024 px octopus app icon (build/icon.png, from build/icon.svg). Run after editing either:
//   npm run icons -w desktop
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()

/**
 * D20: one big dot, 16 pt across in an 18 pt image (1 pt clear on each side), drawn on a 36-unit
 * canvas = the @2x pixels. Its colours read on light and dark menu bars alike, so there is one set,
 * not template images; the white glyph says the state without relying on colour.
 */
const WHITE = '#fff'
const dot = (fill) => `<circle cx="18" cy="18" r="16" fill="${fill}"/>`
const TRAY = {
  synced: dot('#2ea043'),
  pending: dot('#d29922') + [11, 18, 25].map((x) => `<circle cx="${x}" cy="18" r="2.6" fill="${WHITE}"/>`).join(''),
  syncing:
    dot('#2f81f7') +
    `<path d="M18 10.5A7.5 7.5 0 1 1 10.5 18" fill="none" stroke="${WHITE}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M10.5 11.5L15 17.5H6Z" fill="${WHITE}"/>`,
  attention: dot('#da3633') + `<rect x="16.25" y="8" width="3.5" height="13" rx="1.75" fill="${WHITE}"/><circle cx="18" cy="26" r="2.1" fill="${WHITE}"/>`,
  paused: dot('#da3633') + `<rect x="12" y="10.5" width="4" height="15" rx="1" fill="${WHITE}"/><rect x="20" y="10.5" width="4" height="15" rx="1" fill="${WHITE}"/>`,
  // No folders: a hollow grey ring, the same size as the dot.
  plain: `<circle cx="18" cy="18" r="14.5" fill="none" stroke="#8b949e" stroke-width="3"/>`,
}

const dir = `${desktop}resources/tray`
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const [state, shapes] of Object.entries(TRAY)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${shapes}</svg>`
  writeFileSync(`${dir}/tray-${state}.png`, png(svg, 18))
  writeFileSync(`${dir}/tray-${state}@2x.png`, png(svg, 36))
}
writeFileSync(`${desktop}build/icon.png`, png(readFileSync(`${desktop}build/icon.svg`, 'utf8'), 1024))
console.log('rendered resources/tray/*.png and build/icon.png')
