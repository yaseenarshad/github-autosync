import type { ActivityPage, AppStatus, FolderVerdict, NavTarget, PullEvery, PushEvery, RepoSettings, ThemeChoice } from './types'

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
  /** D25 "Send again": forget a batch whose PR a human closed, then send it as a fresh PR. */
  resendPullRequest(id: string): Promise<void>
  /** Newest first; pass the returned cursor to page back. */
  activity(id: string, cursor?: number): Promise<ActivityPage>
  setLaunchAtLogin(on: boolean): Promise<AppStatus>
  setTheme(theme: ThemeChoice): Promise<AppStatus>
  /** D34: the folder's repo gets these settings, on every computer (D35). Throws while its origin is unknown. */
  setRepoSettings(id: string, settings: RepoSettings): Promise<AppStatus>
  /** D35: the native picker for the settings folder; null when cancelled. */
  pickSettingsFolder(): Promise<string | null>
  /** D35: null stops sharing; this computer keeps its own copy. */
  setSettingsFolder(path: string | null): Promise<AppStatus>
  /** D44: the folder picker — the folders right under `rel` ('' is the top), without what git ignores. */
  listFolders(id: string, rel: string): Promise<string[]>
  /** D46: one send that also takes the changes outside the picked folders; resolves when it is done. */
  pushOutside(id: string): Promise<void>
  /** D51: off for `minutes`, then on again by itself; null resumes now. */
  pauseFolder(id: string, minutes: number | null): Promise<AppStatus>
  /** D53: adds the clone found for another computer's repo, with its settings. Answers the Add folder checks (D12): not ok → nothing was added. */
  addOther(key: string): Promise<FolderVerdict>
  /** D54: picks a parent folder, clones the repo into it and adds it. Progress and failure show in `others`. */
  cloneOther(key: string): Promise<void>
  /** Item 19: the push and pull a repo starts with until someone changes its settings. */
  setDefaults(defaults: { push: PushEvery; pull: PullEvery }): Promise<AppStatus>
  /** D53: "Not on this Mac"; null shows every hidden repo again. */
  hideOther(key: string | null): Promise<AppStatus>

  showInFinder(id: string): Promise<void>
  /** Only `https://github.com/…` URLs are opened. */
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>

  /** D18: the native right-click menu for a folder (sidebar row or overview row). */
  showFolderMenu(id: string): Promise<void>
  /** Null clears the nickname. */
  setAlias(id: string, alias: string | null): Promise<AppStatus>
  openInTerminal(id: string): Promise<void>
  openInEditor(id: string): Promise<void>
}
