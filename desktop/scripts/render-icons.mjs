// Renders the committed PNGs from the two SVG sources: the menu bar octopus in every state
// (resources/tray) and the 1024 px app icon (build/icon.png). Run after editing either SVG:
//   npm run icons -w desktop
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()

// The octopus's own shapes, recoloured: black body for a light menu bar, white for a dark one.
const octopus = readFileSync(`${desktop}build/octopus.svg`, 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<!--[\s\S]*?-->/g, '')

const DOT = { synced: '#3fb950', pending: '#d29922', attention: '#f85149', syncing: '#58a6ff' }

/** 32-unit canvas: the badge sits bottom-right (r 7 = 3.5 px at 16 px), cut out of the octopus so it reads at menu bar size. */
function traySvg(state, body) {
  const shapes = octopus.replaceAll('#000', body)
  if (state === 'plain') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${shapes}</svg>`
  const badge =
    state === 'paused'
      ? `<rect x="19.5" y="18" width="4" height="13" rx="1" fill="${body}"/><rect x="26.5" y="18" width="4" height="13" rx="1" fill="${body}"/>`
      : `<circle cx="25" cy="25" r="7" fill="${DOT[state]}"/>`
  const cut = `<mask id="cut"><rect width="32" height="32" fill="#fff"/><circle cx="25" cy="25" r="9.5" fill="#000"/></mask>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${cut}</defs><g mask="url(#cut)">${shapes}</g>${badge}</svg>`
}

mkdirSync(`${desktop}resources/tray`, { recursive: true })
for (const state of ['plain', 'synced', 'pending', 'attention', 'syncing', 'paused']) {
  for (const [variant, body] of [['light', '#000'], ['dark', '#fff']]) {
    const svg = traySvg(state, body)
    writeFileSync(`${desktop}resources/tray/tray-${state}-${variant}.png`, png(svg, 16))
    writeFileSync(`${desktop}resources/tray/tray-${state}-${variant}@2x.png`, png(svg, 32))
  }
}
writeFileSync(`${desktop}build/icon.png`, png(readFileSync(`${desktop}build/icon.svg`, 'utf8'), 1024))
console.log('rendered resources/tray/*.png and build/icon.png')
