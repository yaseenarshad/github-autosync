/**
 * Hidden Electron windows and their pictures, for capture.mjs. No browser-automation library:
 * only Electron's own BrowserWindow and its DevTools protocol (`webContents.debugger`).
 *
 * A window here is never shown: `show: false`, cannot take focus, paints while hidden, is not
 * throttled, and sits off every screen, so the person at the Mac sees nothing and keeps the
 * keyboard. Its page is laid out at exactly `width` × `height` CSS px and drawn at `scale` (CDP
 * `Emulation.setDeviceMetricsOverride`), whatever the screen's own scale is. Input, when a picture
 * needs a click, goes to the page through CDP (`Input.dispatchMouseEvent`), never through the OS.
 */
import { BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The demo scene each window's preload asks for (lib/demoApi.cjs), by webContents id. */
const scenes = new Map()
ipcMain.on('demo:scene', (event) => {
  event.returnValue = scenes.get(event.sender.id) ?? null
})

/** Somewhere no screen is: right of and below all of them. */
function offscreen() {
  const bounds = screen.getAllDisplays().map((d) => d.bounds)
  return { x: Math.max(...bounds.map((b) => b.x + b.width)) + 400, y: Math.max(...bounds.map((b) => b.y + b.height)) + 400 }
}

/**
 * Opens `url` in a hidden window. `preload` + `scene`: the demo API for the real client. `clear`:
 * a transparent page background, for designed pages with round corners.
 */
export async function openPage(url, { width, height, scale = 2, preload = null, scene = null, clear = false }) {
  const win = new BrowserWindow({
    ...offscreen(),
    width,
    height,
    show: false,
    focusable: false,
    skipTaskbar: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    enableLargerThanScreen: true,
    backgroundColor: clear ? '#00000000' : '#ffffff',
    transparent: clear,
    webPreferences: {
      backgroundThrottling: false,
      preload: preload ?? undefined,
      contextIsolation: preload === null,
      sandbox: preload === null,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  if (scene) scenes.set(win.webContents.id, scene)
  await win.loadURL(url)
  // Attached only once a page is there: Electron 43 crashes when the protocol is used before.
  const cdp = win.webContents.debugger
  cdp.attach('1.3')
  const send = (method, params = {}) => cdp.sendCommand(method, params)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  if (clear) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  const page = new Page(win, send, { width, height, scale })
  await page.settle()
  return page
}

export class Page {
  constructor(win, send, size) {
    this.win = win
    this.send = send
    this.size = size
  }
  /** Runs `fn(arg)` in the page and returns its (JSON) result. */
  eval(fn, arg) {
    return this.win.webContents.executeJavaScript(`(${fn})(${JSON.stringify(arg ?? null)})`, true)
  }
  /** Fonts loaded, images decoded, two frames painted. */
  async settle(ms = 120) {
    await this.eval(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].filter((img) => img.src).map((img) => img.decode().catch(() => {})))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await sleep(ms)
  }
  /** Waits until `selector` is in the page. */
  async waitFor(selector, timeout = 10_000) {
    const start = Date.now()
    while (!(await this.eval((s) => document.querySelector(s) !== null, selector))) {
      if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${selector}`)
      await sleep(50)
    }
  }
  /** The CSS-px box of the first element matching `selector` (and containing `text`, when given). */
  async rect(selector, text) {
    const box = await this.eval(
      ([s, t]) => {
        const el = [...document.querySelectorAll(s)].find((e) => !t || e.textContent.includes(t))
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      },
      [selector, text ?? null],
    )
    if (box === null) throw new Error(`nothing matches ${selector}${text ? ` with “${text}”` : ''}`)
    return box
  }
  /** A real click on the page (CDP input, not the OS mouse) at the middle of `selector`. */
  async click(selector, text) {
    const r = await this.rect(selector, text)
    const [x, y] = [r.x + r.width / 2, r.y + r.height / 2]
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 })
    }
    await this.settle()
  }
  /** The page as a PNG at its scale (optionally only `clip`, in CSS px) → `file`. */
  async shot(file, clip) {
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false }
    if (clip) params.clip = { ...clip, scale: 1 }
    const { data } = await this.send('Page.captureScreenshot', params)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }
  close() {
    scenes.delete(this.win.webContents.id)
    this.win.destroy()
  }
}
