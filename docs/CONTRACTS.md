# GitHub AutoSync — contracts

How the app behaves, in one place. The code is the source of truth; this names where each rule lives.

- `shared/types.ts` — every shape the window and the menu bar render.
- `shared/api.ts` — what the renderer can ask of the main process (`window.autosync`).
- `shared/status.ts` — rules both sides must agree on: cadence, worst state, the summary line, time and plural wording.
- `desktop/src/main/git/` — the engine: `sync.ts` (one pass), `manager.ts` (when passes run), `resolve.ts` (keep-both), `detect.ts` (read-only facts), `exec.ts` (the only child process), `activity.ts` (history).

## 1. Status model

- Each folder has one `SyncState`, set by `manager.ts` `stateOf`, in this order:
  - `off` — the folder is disabled, or the app is paused (`AppStatus.paused` says which).
  - `syncing` — a pass is running. `direction` is `down` while receiving, `up` while sending. The quiet idle poll never shows as `syncing`.
  - `attention` — the user has to act (`attention` says why).
  - `pending` — changes are waiting for the debounce, the folder is offline, or `pending` is not empty.
  - `synced` — level with GitHub.
- `AttentionKind` values:
  - `conflict` — derived from the tree: any tracked `<name> (conflict <host>, <YYYY-MM-DD>[ n])<ext>` file. It does **not** stop syncing (D6), and it clears on every computer once the copies are deleted.
  - `auth` — GitHub refused the credentials. `detail` holds git's `fatal:` line. Nothing retries on its own; the next edit, wake or Sync now tries again.
  - `no-git` — no working git binary (the macOS CLT shim without the tools counts as none).
  - `no-identity` — git has no `user.name` / `user.email`.
  - `busy-repo` — the repo is mid-rebase, mid-merge or on a detached HEAD (`detail`). AutoSync makes zero writes (D16).
  - `error` — anything else, in git's own words.
- Other folder fields:
  - `offline` — the last pass could not reach GitHub. This is not an attention.
  - `retryAt` — when the single offline retry fires.
  - `sendAt` — when the debounce fires ("Sends in 0:23").
  - `pendingSince` — when the current run of unsent changes began (drives the one-hour notice, D7).
  - `lastSyncedAt` — the last pass that ended level with origin.
  - `lastCheckedAt` — the last successful fetch.
  - `tooBig` — files of 95 MiB or more that are held back (D11). They are never counted in `pending`.
- Worst state, used for the menu bar icon, the toolbar dot and sorting: attention > pending > syncing > synced > off (`byWorst`). Paused overrides everything in the menu bar.
- Summary line (`headline`), the same in the window and the menu bar, first match wins:
  - `No folders yet`
  - `Paused`
  - `Git not found`
  - `N folder(s) need you`
  - `Offline · changes waiting`
  - `Syncing…`
  - `N waiting to send`
  - `Sync is off`
  - `All synced`
- "Last synced" means the latest `lastSyncedAt` of any folder (`lastSyncedAt`).

## 2. IPC API (`shared/api.ts`)

- Every method except the two subscriptions is `ipcRenderer.invoke` on channel `autosync:<method>` (`desktop/src/channels.ts`).
- Mutations write `config.json`, apply it to the manager, and resolve with the fresh `AppStatus`. The same status is also pushed.
- Pushes:
  - `autosync:status` — sent on every status change, throttled to at most four times a second.
  - `autosync:navigate` — sent on menu bar and notification clicks, as a `NavTarget` (`folderId`, optional `sheet`, optional `copyPrompt`). The preload holds the latest target until the renderer subscribes.
- Methods:
  - `getStatus`
  - `pickFolder` — the native picker; null when cancelled.
  - `checkFolder` — the add-folder verdict (D12). The checks run in this order: no-git, not-git, not-root (with `root`), already-added, no-origin, auth. Offline is still `ok`.
  - `addFolder`, `removeFolder`, `setFolderEnabled`, `setPaused`, `setLaunchAtLogin`, `setTheme`, `setAlias` — mutations. `removeFolder` never touches files. A null alias clears the nickname.
  - `syncNow(id | null)` — resolves when the passes are done. Null means every active folder.
  - `activity(id, cursor?)` — 200 commits a page, newest first. `cursor` is the number of commits to skip.
  - `showInFinder`, `openInTerminal`, `openInEditor` (`vscode://file/…`) — throw when the folder is gone.
  - `openExternal` — opens `https://github.com/…` only.
  - `copyText`
  - `showFolderMenu` — the native right-click menu (D18).
- Confirmations (D15) live in the renderer; the API acts immediately. The menu bar and the folder menu only open sheets. AI prompt texts live in the renderer, so the "Copy AI prompt" menu item navigates with `copyPrompt: true`.

## 3. Sync algorithm (`sync.ts`, one pass that never throws)

1. **Refuse** a busy repo (D16) and a repo with no `origin`.
2. **Commit.** Untracked and modified files of 95 MiB or more are excluded from `add -A` by literal pathspec, so they are never hashed. Anything staged over the line afterwards is unstaged. The rest becomes one commit, `sync (<host>): a.md, b.md, c.md +N more`.
3. **Fetch** `origin` (10-minute transfer budget). Skipped on the quit flush.
4. **Rebase** onto `@{u}` when behind, never merge.
   - A held-back tracked file is stashed around the rebase and copied back afterwards. The stash is only restored and dropped if `refs/stash` moved, so the user's own stashes are never touched.
   - Same-file conflicts are resolved with keep-both (`resolve.ts`): GitHub's version stays at the path and this computer's goes beside it as the conflict copy. When one side deleted the file and the other edited it, the edit wins.
   - Saves made while the rebase was stopped are parked and put back.
   - Anything unexpected aborts the rebase back to the starting tree.
5. **Push.** `-u origin HEAD` on the first push. A push that lost a race to another computer re-runs the exchange once. The quit flush uses a 5 s push cap.
6. **Classify failures.**
   - A timeout counts as offline.
   - Auth is checked before offline, because git wraps most auth failures in the offline envelope.
   - Identity comes next; everything else is `error` with git's first `fatal:`/`error:` line.
7. **Re-read the facts:** pending, `.gitignore` summary, conflict copies, branch, remote.

## 4. Triggers and cadence (`manager.ts`, numbers in `shared/status.ts`)

- **Start / enable / resume:** a pass right away.
- **Edits:** a watcher event is only a hint.
  - After a 1 s settle (`PEEK_MS`), `git status` decides.
  - Real changes mark the folder pending and arm a 30 s trailing debounce (`DEBOUNCE_MS`).
  - A clean look (an ignored file, or an edit undone) cancels the send.
- **Own writes:** watcher events during a pass, or within 1 s of one (`OWN_WRITES_MS`), are ignored. An edit made during a pass is caught by the pass's closing status.
- **Offline:** exactly one retry after 2 min (`OFFLINE_RETRY_MS`).
- **Idle:** a pass that ended level arms a quiet pull after 60 s (`POLL_MS`). Conflict copies do not stop it. Any other attention, offline, or edits that are settling do.
- **Wake / unlock:** a pull, unless a pass ran in the last 10 s (`WAKE_COOLDOWN_MS`).
- **Quit:** the watchers close, then each folder gets a flush pass (commit plus a capped push). The quit is held for at most 15 s.
- **Invariants:**
  - One pass at a time per folder. A burst of triggers during a pass collapses into one follow-up that runs the strongest mode requested (flush > normal > quiet).
  - Off means off: a disabled folder, or any folder while paused, has no watcher, no timers and no git.

## 5. Persistence

- `<userData>/config.json` (D5): `{ version: 1, folders: [{ id, path, enabled, alias? }], launchAtLogin, paused, theme }`.
  - Written with temp file + rename.
  - A write the next load would reject is refused.
  - A file that will not parse is moved to `config.json.bak`, and the app starts from defaults.
- Nothing is written into synced folders. Activity is read from git history only (D10).

## 6. Decisions

- **D1** — Lift the sync engine from the Draw app (`yaseen-draw-app@89b29c9`). The copied files say so in their header.
- **D2** — A folder the Docs or Draw app also syncs gets a warning, never a refusal.
- **D3** — Cadence: pass on start and enable, 30 s debounce after edits, 60 s idle pull, pull on wake, one offline retry, flush on quit.
- **D4** — Window plus menu bar (tray on Windows). Closing the window hides it. Launch at login is on by default and starts in the menu bar.
- **D5** — Local `config.json` per computer. Folders are added one by one with Add folder on each computer.
- **D6** — Keep-both conflicts; syncing never stops for them. "Copy AI prompt" asks an assistant to merge the copies.
- **D7** — Notify only when a folder enters attention, or when changes have been pending for over an hour. Once per episode, never on success.
- **D8** — Ship a mac arm64 dmg (ad-hoc signed) and a Windows x64 NSIS installer (unsigned).
- **D9** — No secret filter: `.gitignore` is the only filter.
- **D10** — Activity comes from git history only: day summaries, bursts of under 20 min from the same computer collapsed, file search, paging.
- **D11** — Files of 95 MiB or more are held back and listed; everything else syncs.
- **D12** — Use git's existing login (`gh auth login` + `gh auth setup-git`). `ls-remote` checks access when a folder is added.
- **D13** — The octopus is the app icon (superseded in the menu bar by D20).
- **D14** — GitHub-Desktop-style GUI.
- **D15** — Confirmation before any on/off change, with Cancel focused.
- **D16** — Commit subject `sync (<host>): …`. Busy repos are skipped with zero writes. Every problem has a Copy AI prompt.
- **D17** — The Dock icon is hidden while the window is.
- **D18** — Folder right-click menu with nicknames (Rename in AutoSync), Terminal and VS Code.
- **D19** — Theme System/Light/Dark for the window.
- **D20** — The menu bar icon is a big status dot (grey ring with no folders); paused is red with ⏸; the octopus stays the app icon.
