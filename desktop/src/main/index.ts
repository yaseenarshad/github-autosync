import { app, BrowserWindow, Menu, nativeTheme, Notification, powerMonitor, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { AppStatus, NavTarget } from '@shared/types'
import { NAVIGATE_CHANNEL, STATUS_CHANNEL } from '../channels'
import { findGit } from './git/exec'
import { createSyncManager } from './git/manager'
import { hostName, peekPending, syncFolder } from './git/sync'
import { registerIpc, throttle } from './ipc'
import { createNoticeRules, type Notice } from './notify'
import { createRegistry } from './registry'
import { createTray } from './tray'
import { watchFolder } from './watch'

// An isolated profile for hands-on testing; must be set before anything reads `userData`.
if (process.env.AUTOSYNC_USER_DATA) app.setPath('userData', process.env.AUTOSYNC_USER_DATA)

/** One running instance: a second launch shows the first one's window. */
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

const HOST = hostName()

/** Quitting waits for the flush (commit + 5 s push), and for a pass already mid-transfer — but never longer than this. */
const QUIT_CAP_MS = 15_000

/** How often the one-hour pending notice (D7) is re-checked when nothing else changes. */
const NOTICE_TICK_MS = 60_000

let win: BrowserWindow | null = null
let quitting = false
let tray: ReturnType<typeof createTray> | undefined
let gitMissing = false

/** D5: `<userData>/config.json`. Nothing starts syncing until `apply()` hands its folders to the manager. */
const registry = createRegistry(app.getPath('userData'))
const manager = createSyncManager({
  sync: (root, opts) => syncFolder(root, { ...opts, host: HOST }),
  peek: (root) => peekPending(root),
  watch: watchFolder,
  onChange: () => refresh(),
})

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 960,
    minHeight: 620,
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // D4: closing the window hides it — the app lives in the menu bar until it is quit.
  created.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    created.hide()
    app.dock?.hide() // D17: no Dock icon while the app lives only in the menu bar
  })
  created.once('ready-to-show', () => created.show())
  if (process.env.ELECTRON_RENDERER_URL) void created.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void created.loadFile(join(__dirname, '../renderer/index.html'))
  return created
}

function showWindow(): BrowserWindow {
  // Installing git is the one fix made outside the app; opening the window is when it gets noticed.
  void probeGit()
  void app.dock?.show()
  if (win === null) {
    win = createWindow()
    return win
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/** Menu bar and notification clicks: show the window, then take it where the click meant. */
function navigate(target: NavTarget): void {
  const shown = showWindow()
  if (shown.webContents.isLoading()) shown.webContents.once('did-finish-load', () => shown.webContents.send(NAVIGATE_CHANNEL, target))
  else shown.webContents.send(NAVIGATE_CHANNEL, target)
}

function status(): AppStatus {
  const config = registry.get()
  const folders = manager.folders()
  return { folders, paused: config.paused, gitMissing: gitMissing || folders.some((f) => f.attention?.kind === 'no-git'), hostname: HOST, launchAtLogin: config.launchAtLogin, theme: config.theme }
}

async function probeGit(): Promise<void> {
  gitMissing = (await findGit()) === null
  refresh()
}

/** Electron drops a Notification that is garbage-collected before it is clicked; these are held until then. */
const liveNotices = new Set<Notification>()

function notify(notice: Notice): void {
  if (!Notification.isSupported()) return
  const note = new Notification({ title: notice.title, body: notice.body })
  liveNotices.add(note)
  note.on('click', () => {
    liveNotices.delete(note)
    navigate({ folderId: notice.folderId })
  })
  note.on('close', () => liveNotices.delete(note))
  note.show()
}

const noticeRules = createNoticeRules()

/** Every status change fans out here — window, menu bar, notifications — at most four times a second. */
const refresh = throttle(() => {
  const current = status()
  if (win !== null && !win.isDestroyed()) win.webContents.send(STATUS_CHANNEL, current)
  tray?.update(current)
  for (const notice of noticeRules(current, Date.now())) notify(notice)
}, 250)

function apply(): void {
  const config = registry.get()
  manager.setFolders(config.folders, config.paused)
  // D19: the renderer's CSS follows `prefers-color-scheme`, which follows this — nothing else to tell it.
  nativeTheme.themeSource = config.theme
  // A dev build would register the Electron binary itself as a login item.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.launchAtLogin })
}

function appMenu(): Menu | null {
  // Windows and Linux get no menu bar: the tray menu is the app menu there.
  if (process.platform !== 'darwin') return null
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => navigate({ folderId: null, sheet: 'settings' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

app.on('second-instance', () => {
  if (app.isReady()) showWindow()
})

void app.whenReady().then(() => {
  if (!primary) return
  registerIpc({ registry, manager, hostname: HOST, status, apply, navigate })
  Menu.setApplicationMenu(appMenu())
  tray = createTray(join(app.getAppPath(), 'resources', 'tray'), {
    open: navigate,
    openWindow: () => void showWindow(),
    syncAll: () => void manager.syncNow(null),
    quit: () => app.quit(),
  })
  apply() // D3: app start is a pass per enabled folder
  // D3: a lid that just opened is when the other computer's changes are most likely waiting.
  powerMonitor.on('resume', () => manager.notifyWake())
  powerMonitor.on('unlock-screen', () => manager.notifyWake())
  setInterval(refresh, NOTICE_TICK_MS).unref()
  app.on('activate', () => void showWindow())
  // D4: start in the menu bar; only a first run (nothing to sync yet) opens the window.
  if (registry.get().folders.length === 0) showWindow()
  else {
    app.dock?.hide()
    void probeGit()
  }
})

// The window hides rather than closes, so this only fires on the way out; without a listener Electron would quit.
app.on('window-all-closed', () => undefined)

// Quit (⌘Q, tray Quit): hold it once, land every folder's last changes, then exit for real —
// `app.exit` runs no quit events, so this handler never sees its own exit.
app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  const cap = new Promise<void>((resolve) => setTimeout(resolve, QUIT_CAP_MS))
  void Promise.race([manager.flushForQuit(), cap]).finally(() => app.exit(0))
})
