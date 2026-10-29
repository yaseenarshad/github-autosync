# GitHub AutoSync — contracts

How the app behaves, in one place. The code is the source of truth; this names where each rule lives.

- `shared/types.ts` — every shape the window and the menu bar render.
- `shared/api.ts` — what the renderer can ask of the main process (`window.autosync`).
- `shared/status.ts` — rules both sides must agree on: cadence, worst state, the summary line, time and plural wording.
- `desktop/src/main/git/` — the engine: `sync.ts` (one pass), `pullRequest.ts` (its PR route), `pass.ts` (what both routes share), `github.ts` (the gh seam), `manager.ts` (when passes run), `resolve.ts` (keep-both), `detect.ts` (read-only facts), `exec.ts` (the only child process), `activity.ts` (history).

## 1. Status model

- Each folder has one `SyncState`, set by `manager.ts` `stateOf`, in this order:
  - `off` — the folder is disabled, paused for a while (`pausedUntil`, D51), or the app is paused (`AppStatus.paused` says which).
  - `syncing` — a pass is running. `direction` is `down` while receiving, `up` while sending. The quiet idle poll never shows as `syncing`.
  - `attention` — the user has to act (`attention` says why).
  - `pending` — changes are waiting for their push (D37), the folder is offline, `pending` is not empty, or a batch's PR is open (D26).
  - `synced` — level with GitHub.
- `AttentionKind` values:
  - `conflict` — derived from the tree: any tracked `<name> (conflict <host>, <YYYY-MM-DD>[ n])<ext>` file. It does **not** stop syncing (D6), and it clears on every computer once the copies are deleted.
  - `auth` — GitHub refused the credentials. `detail` holds git's `fatal:` line. Nothing retries on its own; the next edit, wake or Sync now tries again.
  - `no-git` — no working git binary (the macOS CLT shim without the tools counts as none).
  - `no-identity` — git has no `user.name` / `user.email`.
  - `busy-repo` — the repo is mid-rebase, mid-merge, on a detached HEAD, or on a side branch of a repo whose default branch requires PRs (`detail`: `rebase` | `merge` | `detached` | `side-branch`). AutoSync makes zero writes (D16, D29).
  - `no-gh` — the repo requires PRs and `gh` is missing or logged out (`detail`: gh's words, D28).
  - `pr-closed` — a human closed the batch's PR without merging (`detail`: its URL). Never re-sent on its own; "Send again" is `resendPullRequest` (D25).
  - `other-app` — the Docs or Draw app syncs this folder too (`detail`: `Docs` | `Draw`). AutoSync makes zero writes until its switch is off (D27).
  - `outside-changed` — a file outside the picked folders changed here and on GitHub (`files`). The pass stops before the rebase; neither side is touched (D45).
  - `before-push` — the repo's command before a push failed (`detail`: its last 20 lines and why it stopped). Nothing was committed or pushed (D49).
  - `error` — anything else, in git's own words.
- Other folder fields:
  - `publishVia` — `pr` when the repo's rules require PRs on its default branch and the folder is on it, else `push` (D22).
  - `pr` — the batch's PR (`number`, `url`) while it is open (D26).
  - `offline` — the last pass could not reach GitHub. This is not an attention.
  - `retryAt` — when the single offline retry fires.
  - `sendAt` — when the debounce fires ("Sends in 0:23"; in PR mode, when the PR opens).
  - `pendingSince` — when the current run of unsent changes began (drives the one-hour notice, D7).
  - `lastSyncedAt` — the last pass that ended level with origin (in PR mode: the batch merged and landed).
  - `lastCheckedAt` — the last successful fetch.
  - `tooBig` — files of 95 MiB or more that are held back (D11). They are never counted in `pending`.
  - `inUse` — databases held back while a `-wal` or `-journal` file is beside them (D48). Never in `pending`.
  - `outside` — changes outside the picked folders (D46). Never in `pending`; they start no push.
  - `repo` and `settings` — the folder's settings key and its repo's settings (D34).
  - `pullAt` — when the next pull runs (D52). `pausedUntil` — the end of a pause for a while (D51).
- `AppStatus` also carries `settingsFolder`, `settingsFolderMissing` (D35) and `others`: the repos the other computers sync and this one does not (D53).
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
  - `resendPullRequest(id)` — D25 "Send again": forgets the closed batch (`refs/autosync/in-flight`), then a normal pass sends its commits as a fresh PR. Resolves when the pass is done. A no-op unless the folder is active and its attention is `pr-closed`.
  - `activity(id, cursor?)` — 200 commits a page, newest first. `cursor` is the number of commits to skip.
  - `showInFinder`, `openInTerminal`, `openInEditor` (`vscode://file/…`) — throw when the folder is gone.
  - `openExternal` — opens `https://github.com/…` only.
  - `copyText`
  - `showFolderMenu` — the native right-click menu (D18).
  - `setRepoSettings(id, settings)` — the folder's repo gets these settings on every computer (D34, D35). Throws while its origin is unknown.
  - `pickSettingsFolder`, `setSettingsFolder(path | null)` — the settings folder (D35).
  - `listFolders(id, rel)` — the folder picker, one level at a time, without what git ignores (D44).
  - `pushOutside(id)` — one send with the whole repo, the files outside the picks included (D46).
  - `pauseFolder(id, minutes | null)` — a pause for a while; null resumes now (D51).
  - `addOther(key)`, `cloneOther(key)`, `hideOther(key | null)` — the other computers' repos (D53, D54).
- Confirmations (D15) live in the renderer; the API acts immediately. The menu bar and the folder menu only open sheets. AI prompt texts live in the renderer, so the "Copy AI prompt" menu item navigates with `copyPrompt: true`.

## 3. Sync algorithm (`sync.ts`, one pass that never throws)

1. **Refuse** with zero writes, in this order: a busy repo (D16), a folder the Docs/Draw app syncs (D27), a repo with no `origin`.
   - Then the **rules** (D22): the manager's last known `policy`, else `github.repo(origin).policy()` (the repo's rulesets). Not GitHub, gh could not say, or the quit flush (which never asks GitHub) → push mode, not cached.
   - Rules require PRs and the folder is not on the default branch → `busy-repo` `side-branch`, zero writes (D29).
0. **Before-push command** (D49): on a send pass (not a quiet pass, not the quit flush), the repo's `beforePush` runs in the repo root — the login shell on macOS, `cmd.exe` on Windows, 2 min limit. A failure is `before-push`, and the pass stops.
2. **Commit.** Only the picked folders are staged, when the repo has picks (D44). Untracked and modified files of 95 MiB or more (D11), and databases with a `-wal`/`-journal` beside them (D48), are excluded from `add -A` by literal pathspec, so they are never hashed. Anything staged over the line afterwards is unstaged. The rest becomes one commit, `sync (<host>): <shared folder> — a.md, b.md, c.md +N more`, with every file in the body (D50).
   - A failed `add` is asked again, three times in all: a file being written while git reads it fails the whole add and stages nothing.
3. **Fetch** `origin` (10-minute transfer budget). Skipped on the quit flush.
4. **Rebase** onto `@{u}` when behind, never merge.
   - With picks, first compare the changes outside them with `HEAD...@{u}`: a file on both sides is `outside-changed`, and the pass stops (D45). Otherwise the outside changes are parked around the rebase like the held-back files.
   - The fetch takes seconds, so each try first asks again whether the repo is busy (a merge or rebase started meanwhile → `busy-repo`, nothing more is written, D16), then commits whatever was saved since step 2, then rebases at once. A late save replays with the rest and is never stashed (D30).
   - Three tries, then one more commit decides. Nothing new to commit: the rebase failed for another reason, `error` in git's words. Something new: the tree is still being written, so the pass ends quietly — no attention, not level, the saves committed — and the next pass replays them (D31).
   - A rebase git refused to begin is not settled or aborted: the save under it stays on disk as it is.
   - What is ours to push is counted after the rebase.
   - A held-back tracked file (too big, in use, or outside the picks) is stashed around the rebase and copied back afterwards. The stash is only restored and dropped if `refs/stash` moved, so the user's own stashes are never touched.
   - Same-file conflicts are resolved with keep-both (`resolve.ts`): GitHub's version stays at the path and this computer's goes beside it as the conflict copy. When one side deleted the file and the other edited it, the edit wins.
   - Saves made while the rebase was stopped are parked and put back.
   - Anything unexpected aborts the rebase back to the starting tree.
5. **Push.** Never on a quiet pass (D40): it ends with its commits here. Before a push, AutoSync's own unpushed commits fold into one when every one of them is `sync (<this host>)` (D41). `-u origin HEAD` on the first push. A push that lost a race to another computer re-runs the exchange once. The quit flush uses a 5 s push cap.
   - A push refused by a ruleset (`GH013`, "…through a pull request") re-reads the rules in the same pass (not on the quit flush): PRs required → the PR route now (or `side-branch`); gh cannot say → its failure, classified as in 7 below (`no-gh` when it is missing or logged out).
6. **Classify failures.**
   - A timeout counts as offline.
   - Auth is checked before offline, because git wraps most auth failures in the offline envelope.
   - Identity comes next; everything else is `error` with git's first `fatal:`/`error:` line.
7. **Re-read the facts:** pending, `.gitignore` summary, conflict copies, branch, remote.

**PR route** (`pullRequest.ts`, D23), replacing steps 3–5 when the rules require PRs on this branch:

1. The quit flush stops after the commit (S13).
2. **A batch in flight** (`refs/autosync/in-flight` exists): `findPr(autosync/<sha12>)` FIRST, then **fetch** `--prune origin` — so a MERGED answer always meets an `@{u}` that holds its squash. Nothing in flight → just the fetch.
3. The batch's PR decides; no rebase, no push:
   - None yet → finish the send (a pass that died mid-send, S11). Quiet passes wait.
   - OPEN, mergeable or `UNKNOWN` → wait (`pr` set).
   - OPEN, `CONFLICTING` → `closePr` with "Replaced by a newer batch from AutoSync: this one conflicted with main." (deletes its branch), then drop the ref and carry on at 4 (D25). A close that fails keeps the ref and classifies like any gh failure (offline → the quiet retry).
   - MERGED → if the ref is an ancestor of HEAD, `rebase --onto @{u} <ref>` keep-both, with the tries of step 4 (the squash stands in for the batch; later commits replay). Either way drop the ref (S20: never rewrite a history the user moved).
   - CLOSED → `pr-closed`; the ref stays.
4. **Receive:** rebase onto `@{u}` when behind, keep-both, as in step 4.
5. Nothing ahead → level. Commits that net to nothing (`diff --quiet @{u} HEAD`) → `reset --soft @{u}`, level, no PR (S10).
6. **Send** (never on a quiet pass, D24), each step idempotent: `update-ref` the ref to HEAD → `push origin <sha>:refs/heads/autosync/<sha12>` → `findPr`, and `createPr` unless one is OPEN. Base = default branch; title = `commitMessage(host, the batch's files)`, so the squash subject `sync (<host>): a.md (#N)` still reads as a sync in Activity; body = the files, one per line (the first 50, then "…and N more"). Nothing is pushed to a batch's branch once its PR exists.
7. gh failures classify like git's: `offline` (the network, a timeout, a rate limit) → offline, `no-gh` / `auth` / `error` → attention with gh's words. Only a missing gh binary is `no-gh` without them.

## 4. Triggers and cadence (`manager.ts`, numbers in `shared/status.ts`)

- **Per repo** (D34): `push` is Auto (as below), a fixed timer of 5 min to 4 h from the first unsent change (D37), or by hand. `pull` is every 1 to 60 min (`MINUTE_MS`) or by hand (D39). Changing either re-times at once.
- **Start / enable / resume:** a pass right away: a send in Auto, a quiet pass otherwise.
- **Edits:** a watcher event is only a hint.
  - After a 1 s settle (`PEEK_MS`), `git status` decides.
  - Real changes inside the picks mark the folder pending and arm the push: in Auto a 30 s trailing debounce (`DEBOUNCE_MS`), never later than 5 min after the first change (`AUTO_CAP_MS`, D38); a fixed timer otherwise (D37). Changes outside the picks only update `outside` (D47).
  - A clean look (an ignored file, or an edit undone) cancels the send.
- **What the watcher skips** (D33): what git ignores, from `git status --ignored=matching`, plus `.git` and `node_modules` always.
  - One recursive OS watch per folder (FSEvents, ReadDirectoryChangesW). Events under ignored paths are dropped in the app.
  - A folder is skipped whole only when a pattern matches it. A folder whose files are all ignored (only a `.DS_Store`) stays watched.
  - The list is read at the start, and again at most once per `PEEK_MS` after a path is created, renamed or deleted, or a `.gitignore`, `.git/index` or `.git/info/exclude` changes (in a linked worktree or a submodule, where git keeps them outside the folder, too). Each read replaces it. After a failed read, any event reads again.
  - A new ignored file can start one peek before the list catches up. After that it is silent.
- **Own writes:** watcher events during a pass, or within 1 s of one (`OWN_WRITES_MS`), are ignored. An edit made during a pass is caught by the pass's closing status.
- **Offline:** exactly one retry after 2 min (`OFFLINE_RETRY_MS`).
- **Pulls:** every pass arms the next quiet pull (`settings.pull` minutes, D39), also while changes wait. In Auto the pull stands down while a send is armed. A quiet pass commits here and never pushes (D40). Conflict copies do not stop it, nor do the zero-write refusals the user settles outside the app (`pr-closed`, `other-app`, `busy-repo`): the poll is how the folder notices. Any other attention (`no-gh`, `auth`, `no-identity`, `error`), offline, or edits that are settling do.
- **Wake / unlock:** a pull, unless a pass ran in the last 10 s (`WAKE_COOLDOWN_MS`). It sends only in Auto, and does nothing when pulls are by hand (D39).
- **Pause for a while** (D51): off until `pausedUntil`, then on again with a pass.
- **Quit:** the watchers close, then each folder gets a flush pass (commit plus a capped push; commit only in PR mode), except a repo pushed by hand (D42). The quit is held for at most 15 s.
- **PR mode** (D24, D26):
  - The debounce is 5 min (`PR_QUIET_MS`), capped at 30 min (`PR_CAP_MS`): one PR per sitting, not per save. A fixed push timer opens the PR at its time.
  - Quiet passes (the idle poll and the PR check) never send. They may land a merged batch and receive; one that leaves changes unsent arms the debounce.
  - While a PR is open, a quiet check runs every 15 s (`PR_CHECK_MS`) instead of the idle poll.
  - An edit while a PR is open arms no debounce: the PR check commits it, and landing the batch arms the send.
  - The rules are read once per activation and kept per folder; only a successful read replaces them, and turning the folder off forgets them. A refused push re-reads them at once; a removed rule or a renamed default branch applies after a restart or an off/on toggle.
- **Invariants:**
  - One pass at a time per folder. A burst of triggers during a pass collapses into one follow-up that runs the strongest mode requested (flush > normal > quiet).
  - Off means off: a disabled folder, or any folder while paused, has no watcher, no timers and no git.

## 5. Persistence

- `<userData>/config.json` (D5): `{ version: 1, folders: [{ id, path, enabled, alias?, remote?, pausedUntil? }], launchAtLogin, paused, theme, macId, settingsFolder, repos, hiddenRepos }`.
  - `repos` holds each repo's settings and `savedAt`, by key (D34). A config from before D34 loads with the defaults.
- The settings folder (D35, D36): each computer writes only `settings-<macId>.json` there — its repos, where it keeps them, whether it syncs them, and their settings. The newest `savedAt` wins per repo. One watch on the folder, plus a read every 30 s for a missed event.
  - Written with temp file + rename.
  - A write the next load would reject is refused.
  - A file that will not parse is moved to `config.json.bak`, and the app starts from defaults.
- Nothing is written into synced folders, except the user's own settings folder (D35). Activity is read from git history only (D10).
- PR mode keeps one local ref, `refs/autosync/in-flight` (the batch in flight, D23). It lives in `.git`, is never pushed, and never touches the working tree.

## 6. Decisions

- **D1** — Lift the sync engine from the Draw app (`yaseen-draw-app@89b29c9`). The copied files say so in their header.
- **D2** — A folder the Docs or Draw app also syncs gets a warning, never a refusal. *Superseded by D27.*
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
- **D21** — PR publishing lives in AutoSync only.
- **D22** — Push or PR is the repo's rules' call, never a setting: PR mode when the default branch's rulesets include a `pull_request` rule and the folder is on it. No rule, or not GitHub → push mode, exactly as before.
- **D23** — One immutable branch and PR per batch (`autosync/<sha12>`), marked by the local ref `refs/autosync/in-flight`; the repo's Action squash-merges it. While it is in flight: no rebase, no push. Merged → land it and send the next.
- **D24** — PR mode waits 5 min after the last edit; quiet passes never send.
- **D25** — A PR that conflicts is closed and replaced by a keep-both replay. One a human closed asks the user ("Send again"), never re-sent on its own.
- **D26** — A folder with a PR open is `pending`, and shows the PR.
- **D27** — A folder the Docs or Draw app syncs gets `other-app` and zero writes, in both modes. Add folder still only warns.
- **D28** — GitHub calls go through the user's own `gh` (explicit paths, `-R owner/repo`, run from the filesystem root, prompts off). Missing or logged out → `no-gh`.
- **D29** — A side branch of a PR-rule repo is never touched once the rules are known (`busy-repo` `side-branch`).
- **D30** — A save that lands under a rebase is committed and replayed, never stashed: it goes through keep-both like any other edit.
- **D31** — A tree that will not hold still for three tries is `pending`, not an `error`. The debounce tries again (30 s; 5 min in PR mode), and the one-hour notice (D7) covers a writer that never stops.
- **D32** — A file some program rewrites on every pass is synced like any other. `.gitignore` stays the only filter (D9).
- **D33** — The watcher skips what git ignores, as git itself reads it (every `.gitignore`, `.git/info/exclude`, the global excludes file), through one recursive OS watch per folder. No built-in list beyond `.git` and `node_modules`. What gets committed does not change (D9).
- **D34** — Each repo has its own settings (push, pull, picked folders, a command before a push), keyed by its origin: `github.com/<owner>/<repo>` in lower case. The defaults behave as before.
- **D35** — A settings folder that git syncs carries the settings between computers. Each computer writes only its own file; the newest change wins per repo. Changes D5.
- **D36** — The file shape: `{ name, savedAt, repos: { <key>: { remoteUrl, path, syncing, savedAt, settings } } }`. A field a build cannot read keeps this computer's value.
- **D37** — Push timing per repo: Auto (D3), 5 min to 4 h on a fixed timer from the first unsent change, or by hand.
- **D38** — Auto never waits longer than 5 min after the first unsent change (PR mode: 30 min).
- **D39** — Pull timing per repo: every 1 to 60 min, or by hand. Pulls run while changes wait. A wake pulls, and sends only in Auto.
- **D40** — A quiet pass never pushes, in push mode too. It commits here, fetches and rebases.
- **D41** — Before a push, AutoSync's own unpushed commits fold into one; a commit made by hand stops the fold. Not in PR mode.
- **D42** — The quit flush skips a repo pushed by hand, and obeys the picks.
- **D43** — The pending notice comes an hour after the push was due; never for a repo pushed by hand. Changes D7.
- **D44** — Picked folders: only they are staged; the pull is still the whole repo. Changes D9.
- **D45** — A file outside the picks changed here and on GitHub stops the pass before the rebase (`outside-changed`); AutoSync never undoes the other side.
- **D46** — Changes outside the picks are listed, never pending; "Push these now…" sends them once.
- **D47** — An edit outside the picks starts no push.
- **D48** — A file with a `-wal` or `-journal` beside it is held back while it is there. Changes D32 for this case.
- **D49** — A command before each send, in the repo root; a failure is `before-push`, and nothing is committed or pushed.
- **D50** — Commit subjects name the folder the files share (two levels at most); the body lists every file.
- **D51** — Pause one repo for 1 or 4 hours; it turns back on by itself. Local to the computer.
- **D52** — The folder shows the next push and the next pull; Push now sends at once.
- **D53** — "On your other computers": repos another computer syncs and this one lacks. Add finds the clone and starts it with the travelled settings; nothing turns on before a click.
- **D54** — Clone… picks a parent folder and clones there; a folder already there stops it.
- **D55** — No settings file inside the repos.
- **D56** — Delivered through a PR with the required checks; no release of its own.
