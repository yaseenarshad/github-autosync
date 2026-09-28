# YAZ-1998 Initial Build — GitHub AutoSync

## Goal
- Ship GitHub AutoSync v1 as locked on YAZ-1998 (D1–D19): Electron window + menu bar octopus, multi-folder auto commit/pull/push engine lifted from Draw, GUI from the approved demo.
- Done = typecheck + vitest + build green, Yasin's 5C hands-on checklist passed, merged to `main`, every Linear issue Done.

## Constraints
- No Playwright / browser automation. Tests = vitest with real git + local bare remotes. Human tests = dev app, isolated userData, throwaway repo.
- Commits via /commit skill style (no attribution). Merge to main allowed at the end. Release only when Yasin asks (he asked for v0.1.0 at closeout).

## Key Decisions
- Behaviour, IPC API, sync algorithm, cadence and D1–D19 are written up in `docs/CONTRACTS.md` — read that first.
- Contract in `shared/`: `types.ts` + `api.ts` (renderer ↔ main), `status.ts` (cadence, worst state, summary line, clock/plural — the window and the menu bar both import it), `testFixtures.ts` (test-only builders for both suites).
- Conflict attention is derived from tracked `(conflict <host>, <date>)` files, never stored; sync keeps running.
- Copy AI prompt texts live in the client only; notifications just open the folder.
- Tray artwork: pre-rendered PNGs (`npm run icons -w desktop`, resvg), committed.
- chokidar is bundled into `out/main` (`externalizeDeps: false`), so the packaged app ships no node_modules; it is a devDependency.

## State
- Done:
  - [x] 1 Deep scope, Linear tree YAZ-2001…2025 + scenario catalog
  - [x] 2A scaffold, 2B shell
  - [x] 3A–3F engine
  - [x] 4A–4E GUI (+ YAZ-2026/2027/2028/2049 follow-ups, D17–D19)
  - [x] 5A/5B automated proofs, 5C Yasin hands-on
  - [x] 6A audit (YAZ-2023), 6B apply (YAZ-2024)
- Remaining:
  - [ ] Merge `yaz-1998-initial-build` to `main`, Linear Done

## Gotchas
- `electron-vite dev --watch` restarts Electron on main/preload edits, and every restart goes through `before-quit`, which holds the exit for the quit flush (≤ 15 s). Expect a pause, and always dev against `AUTOSYNC_USER_DATA=<tmp dir>` so a flush never touches real folders.
- Quit is held once in `before-quit` and finished with `app.exit(0)` (no quit events), so the handler never sees its own exit.
- The window hides on close (D4); `window-all-closed` has a no-op listener or Electron would quit.
- Git tests set `core.autocrlf=false` locally (Git for Windows defaults it on) and pass hook paths through `shPath`; the git-timeout kill test is skipped on Windows (the `cmd\git.exe` launcher) — unverified there.
- `stash push` exits 0 when it saves nothing; `parkWhileRebasing` compares `refs/stash` before/after so a user's stash is never dropped.

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/github-autosync-yaz-1998`, branch `yaz-1998-initial-build`.
- Run: `npm run dev` (with `AUTOSYNC_USER_DATA`), or `npm run dev -w client` for the window alone on the fake API.
- Test: `npm run typecheck`, `npm test`, `npm run build`. CI runs all three on macOS and Windows.
- Release: tag `vX.Y.Z` and push the tag → `.github/workflows/release.yml` attaches the dmg + setup exe.
- Draw source: `/Users/yasin/Documents/GitHub/yaseen-draw-app/desktop/src/main/git/` @ 89b29c9.
