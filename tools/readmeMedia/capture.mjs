/**
 * USAGE: node_modules/.bin/electron tools/readmeMedia/capture.mjs [--out docs/assets] [--only hero,dot,…] [--work <dir>]
 *
 * Makes every picture and GIF of the README. Run it from the repository's root; it needs ffmpeg
 * (/opt/homebrew/bin/ffmpeg, or set FFMPEG) and nothing else — no build, no browser library:
 *
 *   node_modules/.bin/electron tools/readmeMedia/capture.mjs
 *
 * NOTHING SHOWS ON SCREEN. This file is an Electron main process with no Dock icon (an "accessory"
 * app): every window it opens is hidden, cannot take focus, sits off the screens and is painted
 * and captured through Electron's own DevTools protocol (lib/shoot.mjs). The app in front stays in
 * front, the keyboard and mouse stay yours, and no real screen is ever captured.
 *
 * The app in the pictures is the REAL client: `client/` is served by its own Vite config and
 * loaded in a hidden window whose preload (lib/demoApi.cjs) answers the app's `window.autosync`
 * with made-up data (lib/demoData.mjs: a person called sam, three computers, eight folders — no
 * real name, path or account). The menu bar dots are the app's real tray PNGs. The only things
 * drawn here: the stage around them (stage.css: wallpaper, menu bar, window frames, a plain text
 * editor), the pointer, keycaps, one box or label, and the designed cards (banner, comparison,
 * link preview). The real app profile is never read: the run's profile and Vite's cache live in a
 * scratch folder (`--work`, kept; by default a fresh one in the system's temp folder, removed).
 *
 * What it writes into `--out` (default docs/assets/), the names README.md refers to:
 *   banner.png          1600 × 340   banner.html
 *   hero.gif            1200 wide    hero.html, ~13 s at 20 fps: a line typed on one Mac shows up on the other
 *   dot.png             1600 × 600   dot.html: the menu bar dot's four colours
 *   overview.png        1600 wide    the window's "All folders" page          ┐
 *   history.png         1600 wide    one folder's Activity, a week of syncs    │ window.html around
 *   conflict.png        1600 wide    a conflict, both versions kept            │ the real window
 *   team-pr.png         1600 wide    a team repo that takes pull requests      ┘
 *   step-1.png  step-2.png  step-3.png   1000 × 625   step.html: add a folder, edit, synced
 *   compare.png         1600 × 900   compare.html: its rows are in that page
 *   social-preview.png  1280 × 640   social.html; with the default --out also copied to
 *                                    ~/Downloads/github-autosync-social-preview.png (GitHub takes it by hand)
 * `--only` takes those names without the extension.
 */
import { app, nativeTheme } from 'electron'

// Before anything else: never a Dock icon, never the active app.
app.dock?.hide()
app.setActivationPolicy?.('accessory')

import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scenario } from './lib/demoData.mjs'
import { gif, gifSeconds, png, sizeOf } from './lib/media.mjs'
import { openPage } from './lib/shoot.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const PRELOAD = path.join(HERE, 'lib/demoApi.cjs')

// ---------------------------------------------------------------- arguments
const USAGE = 'usage: node_modules/.bin/electron tools/readmeMedia/capture.mjs [--out docs/assets] [--only name,name] [--work dir]'
const argv = process.argv.slice(process.argv.findIndex((a) => a.endsWith('capture.mjs')) + 1)
const arg = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const DEFAULT_OUT = path.join(REPO, 'docs/assets')
const OUT = path.resolve(arg('--out') ?? DEFAULT_OUT)
const WORK = arg('--work') ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(os.tmpdir(), 'autosync-readme-'))
fs.mkdirSync(WORK, { recursive: true })
app.setPath('userData', path.join(WORK, 'profile'))
for (const flag of ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']) {
  app.commandLine.appendSwitch(flag)
}

// ---------------------------------------------------------------- the real client, served by Vite
let appUrl = null
let vite = null
/** `npm run dev -w client`, in process: the client's own vite.config.ts on a free port. */
async function startClient() {
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
  const { createServer } = await import('vite')
  vite = await createServer({
    configFile: path.join(REPO, 'client/vite.config.ts'),
    root: path.join(REPO, 'client'),
    cacheDir: path.join(WORK, 'vite'),
    server: { port, strictPort: true, host: '127.0.0.1' },
    logLevel: 'error',
    clearScreen: false,
  })
  await vite.listen()
  appUrl = `http://127.0.0.1:${port}/`
}

/**
 * The real window in scene `scene` (lib/demoData.mjs), `w` × `h` CSS px, drawn at `scale`; `steps`
 * may click, navigate or scroll, and returns what the picture needs to know (boxes, a `clip`).
 * Returns `{ file, url, ...whatever steps returned }`.
 */
async function appShot(name, { w = 960, h = 660, scale = 3, scene = name, steps } = {}) {
  appUrl ?? (await startClient())
  const page = await openPage(appUrl, { width: w, height: h, scale, preload: PRELOAD, scene: scenario(scene) })
  try {
    await page.waitFor('.toolbar')
    await page.settle(200)
    const extra = (await steps?.(page)) ?? {}
    await page.settle(250)
    const file = await page.shot(path.join(WORK, 'app', `${name}.png`), extra.clip)
    return { file, url: pathToFileURL(file).href, ...extra }
  } finally {
    page.close()
  }
}

/** Opens folder `id` in the window, as a click in the menu bar's menu does. */
async function openFolder(page, id) {
  page.win.webContents.send('demo:navigate', { folderId: id })
  await page.waitFor('.status')
  await page.settle(200)
}

/** Scrolls the main pane until the section headed `title` is `gap` px under its top. */
const scrollToSection = (page, title, gap = 18) =>
  page.eval(
    ([t, g]) => {
      const main = document.querySelector('.main')
      const head = [...main.querySelectorAll('.section h2')].find((h) => h.textContent.startsWith(t))
      main.scrollTop += head.getBoundingClientRect().top - main.getBoundingClientRect().top - g
    },
    [title, gap],
  )

// ---------------------------------------------------------------- designed pages
/** `tools/readmeMedia/<page>.html` with `params` → `out`: drawn at 2× of `width` × `height`, scaled down to that. */
async function designed(pageName, params, { width, height }, out) {
  const url = pathToFileURL(path.join(HERE, `${pageName}.html`))
  url.searchParams.set('p', JSON.stringify(params))
  const page = await openPage(url.href, { width, height, scale: 2, clear: true })
  try {
    await page.settle(250)
    const raw = await page.shot(path.join(WORK, 'pages', `${path.basename(out, '.png')}@2x.png`))
    png(raw, out, { width, height })
    return out
  } finally {
    page.close()
  }
}

/** A 1600 px picture of the window (`w` × `h` CSS px) on the stage: its size and where the window goes. */
function onStage(h, w = 960) {
  const win = { x: 80, y: 74, w: 1440 }
  return { width: 1600, height: Math.round(win.y + (h * win.w) / w + 58), win, app: { w, h } }
}

// ---------------------------------------------------------------- the assets
const ASSETS = {
  async banner(out) {
    await designed('banner', {}, { width: 1600, height: 340 }, out)
  },

  async hero(out) {
    const fps = 20
    const size = { width: 1200, height: 660 }
    const page = await openPage(pathToFileURL(path.join(HERE, 'hero.html')).href, { ...size, scale: 2 })
    const dir = path.join(WORK, 'hero')
    fs.rmSync(dir, { recursive: true, force: true })
    try {
      await page.settle(250)
      const frames = Math.round((await page.eval(() => window.DURATION)) * fps)
      for (let i = 0; i < frames; i++) {
        await page.eval((t) => window.frame(t), i / fps)
        await page.shot(path.join(dir, `${String(i).padStart(5, '0')}.png`))
      }
    } finally {
      page.close()
    }
    gif(dir, out, { fps, width: size.width })
  },

  async dot(out) {
    await designed('dot', {}, { width: 1600, height: 600 }, out)
  },

  async overview(out) {
    const h = 712
    const shot = await appShot('overview', { h })
    await designed('window', { ...onStage(h), shot: shot.url, dot: 'syncing' }, onStage(h), out)
  },

  async history(out) {
    const h = 700
    const shot = await appShot('history', {
      h,
      steps: async (page) => {
        await openFolder(page, 'ai-skills')
        await scrollToSection(page, 'Activity')
        await page.click('.log', '8:47 AM')
        await page.click('.logs .day', 'Yesterday')
      },
    })
    await designed('window', { ...onStage(h), shot: shot.url, dot: 'synced' }, onStage(h), out)
  },

  async conflict(out) {
    const h = 740
    const shot = await appShot('conflict', {
      h,
      steps: async (page) => {
        await openFolder(page, 'client-notes')
        await page.click('.card details summary')
        // The label goes in the free space right of "See the prompt", under the button it is about.
        const summary = await page.eval(() => {
          const range = document.createRange()
          range.selectNodeContents(document.querySelector('.card details summary'))
          const r = range.getBoundingClientRect()
          return { x: r.right, y: r.y, height: r.height }
        })
        return { box: await page.rect('.card .acts .btn', 'Copy AI prompt'), summary }
      },
    })
    const note = { text: 'Paste it into your AI agent: it merges the two', x: shot.summary.x + 28, y: shot.box.y + shot.box.height + 12 }
    await designed('window', { ...onStage(h), shot: shot.url, dot: 'attention', box: shot.box, note }, onStage(h), out)
  },

  async 'team-pr'(out) {
    const h = 680
    const shot = await appShot('team-pr', {
      h,
      steps: async (page) => {
        await openFolder(page, 'team-handbook')
        return { box: await page.rect('.status') }
      },
    })
    await designed('window', { ...onStage(h), shot: shot.url, dot: 'pending', box: shot.box }, onStage(h), out)
  },

  async 'step-1'(out) {
    const shot = await appShot('step-1', {
      scene: 'add',
      scale: 4,
      steps: async (page) => {
        await page.click('.side-foot .btn-quiet', 'Add folder')
        await page.waitFor('.sheet')
        const sheet = await page.rect('.sheet')
        const button = await page.rect('.sheet footer .btn.blue')
        return { clip: sheet, sheet, button }
      },
    })
    const { sheet, button } = shot
    const target = { x: button.x - sheet.x + button.width * 0.96, y: button.y - sheet.y + button.height * 0.9 }
    await designed('step', { step: 1, shot: shot.url, crop: { w: sheet.width, h: sheet.height }, target }, { width: 1000, height: 625 }, out)
  },

  async 'step-2'(out) {
    await designed('step', { step: 2 }, { width: 1000, height: 625 }, out)
  },

  async 'step-3'(out) {
    const shot = await appShot('step-3', {
      scene: 'synced-now',
      scale: 4,
      steps: async (page) => {
        await openFolder(page, 'marketing')
        const group = await page.rect('.sidebar .group', 'northwind')
        const last = await page.rect('.sidebar .row', 'sops')
        return { clip: { x: 0, y: group.y - 4, width: 279, height: last.y + last.height - group.y + 2 } }
      },
    })
    await designed('step', { step: 3, shot: shot.url, crop: { w: shot.clip.width, h: shot.clip.height } }, { width: 1000, height: 625 }, out)
  },

  async compare(out) {
    await designed('compare', {}, { width: 1600, height: 900 }, out)
  },

  async 'social-preview'(out) {
    // The link preview's picture: the window, all green, on the stage.
    // At 860 px wide the window takes its own narrow layout, which reads better this small.
    const [w, h] = [860, 600]
    const shot = await appShot('social-window', { w, h, scene: 'history' })
    const stage = { width: 1000, height: 740, win: { x: 50, y: 62, w: 900 }, app: { w, h } }
    const picture = path.join(WORK, 'pages', 'social-picture.png')
    await designed('window', { ...stage, shot: shot.url, dot: 'synced', u: 1.6 }, stage, picture)
    await designed('social', { shot: pathToFileURL(picture).href }, { width: 1280, height: 640 }, out)
    if (OUT === DEFAULT_OUT) fs.copyFileSync(out, path.join(os.homedir(), 'Downloads/github-autosync-social-preview.png'))
  },
}

// ---------------------------------------------------------------- run
const only = arg('--only')?.split(',').map((s) => s.trim()) ?? Object.keys(ASSETS)
const unknown = only.filter((name) => !(name in ASSETS))
if (unknown.length > 0) {
  console.error(`no asset named ${unknown.join(', ')}\n${USAGE}\nassets: ${Object.keys(ASSETS).join(', ')}`)
  process.exit(2)
}

app.on('window-all-closed', () => {}) // the run decides when to quit, not its last window
// Electron's "ready" waits for the main module to finish, so no top-level await before it.
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light'
  let failed = false
  for (const name of only) {
    const out = path.join(OUT, `${name}.${name === 'hero' ? 'gif' : 'png'}`)
    const started = Date.now()
    try {
      await ASSETS[name](out)
      const { width, height, bytes } = sizeOf(out)
      const length = out.endsWith('.gif') ? `, ${gifSeconds(out).toFixed(1)} s` : ''
      const took = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`${path.relative(process.cwd(), out)}  ${width} × ${height}, ${Math.round(bytes / 1024)} KB${length}  (${took} s)`)
    } catch (error) {
      failed = true
      console.error(`${name}: ${error.stack ?? error}`)
    }
  }
  await vite?.close()
  if (!arg('--work')) fs.rmSync(WORK, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})
