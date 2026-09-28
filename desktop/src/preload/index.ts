import { contextBridge, ipcRenderer } from 'electron'
import type { AutoSyncApi } from '@shared/api'
import type { AppStatus, NavTarget } from '@shared/types'
import { channel, NAVIGATE_CHANNEL, STATUS_CHANNEL } from '../channels'

/**
 * `window.autosync`. A menu bar or notification click can arrive while the window is still
 * loading — before the renderer has subscribed — so the latest unheard target is held and handed
 * to the first listener instead of being dropped.
 */
const navListeners = new Set<(target: NavTarget) => void>()
let unheard: NavTarget | null = null
ipcRenderer.on(NAVIGATE_CHANNEL, (_event, target: NavTarget) => {
  if (navListeners.size === 0) unheard = target
  for (const listener of navListeners) listener(target)
})

const api: AutoSyncApi = {
  getStatus: () => ipcRenderer.invoke(channel('getStatus')),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: AppStatus) => listener(status)
    ipcRenderer.on(STATUS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(STATUS_CHANNEL, handler)
  },
  onNavigate: (listener) => {
    navListeners.add(listener)
    if (unheard !== null) {
      const target = unheard
      unheard = null
      listener(target)
    }
    return () => navListeners.delete(listener)
  },
  pickFolder: () => ipcRenderer.invoke(channel('pickFolder')),
  checkFolder: (path) => ipcRenderer.invoke(channel('checkFolder'), path),
  addFolder: (path) => ipcRenderer.invoke(channel('addFolder'), path),
  removeFolder: (id) => ipcRenderer.invoke(channel('removeFolder'), id),
  setFolderEnabled: (id, enabled) => ipcRenderer.invoke(channel('setFolderEnabled'), id, enabled),
  setPaused: (paused) => ipcRenderer.invoke(channel('setPaused'), paused),
  syncNow: (id) => ipcRenderer.invoke(channel('syncNow'), id),
  activity: (id, cursor) => ipcRenderer.invoke(channel('activity'), id, cursor),
  setLaunchAtLogin: (on) => ipcRenderer.invoke(channel('setLaunchAtLogin'), on),
  showInFinder: (id) => ipcRenderer.invoke(channel('showInFinder'), id),
  openExternal: (url) => ipcRenderer.invoke(channel('openExternal'), url),
  copyText: (text) => ipcRenderer.invoke(channel('copyText'), text),
}

contextBridge.exposeInMainWorld('autosync', api)
