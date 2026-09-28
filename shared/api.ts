import type { ActivityPage, AppStatus, FolderVerdict, NavTarget } from './types'

/**
 * Everything the renderer can ask of the main process, exposed by the preload as `window.autosync`.
 * Mutations resolve with the fresh `AppStatus`; the same status is also pushed through `onStatus`.
 * Confirmations (D15) live in the renderer — these calls act immediately.
 */
export interface AutoSyncApi {
  getStatus(): Promise<AppStatus>
  onStatus(listener: (status: AppStatus) => void): () => void
  /** Menu bar and notification clicks. */
  onNavigate(listener: (target: NavTarget) => void): () => void

  /** Native folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>
  checkFolder(path: string): Promise<FolderVerdict>
  addFolder(path: string): Promise<AppStatus>
  /** Drops the folder from the list only — files are never touched. */
  removeFolder(id: string): Promise<AppStatus>
  setFolderEnabled(id: string, enabled: boolean): Promise<AppStatus>
  setPaused(paused: boolean): Promise<AppStatus>
  /** One folder, or every enabled folder when null. */
  syncNow(id: string | null): Promise<void>
  /** Newest first; pass the returned cursor to page back. */
  activity(id: string, cursor?: number): Promise<ActivityPage>
  setLaunchAtLogin(on: boolean): Promise<AppStatus>

  showInFinder(id: string): Promise<void>
  /** Only `https://github.com/…` URLs are opened. */
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
}
