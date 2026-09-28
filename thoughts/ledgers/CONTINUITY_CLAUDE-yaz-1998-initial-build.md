# YAZ-1998 Initial Build — GitHub AutoSync

## Goal
- Ship GitHub AutoSync v1 exactly as locked on YAZ-1998 (D1–D16 + scenario catalog): Electron window + menu bar octopus, multi-folder auto commit/pull/push engine lifted from Draw, GUI matching the demo zip.
- Done = typecheck + vitest green, Yasin's 5C hands-on checklist passed, merged to `main`, every Linear issue Done. No release/tag.

## Constraints
- No Playwright / browser automation. Tests = vitest with real git + local bare remotes. Human tests = dev app, isolated userData, throwaway repo.
- Commits via /commit skill style (no attribution). Push + merge to main allowed at the end. Never tag/release.
- Architecture/design questions go to Yasin in problem/options/recommendation/diff/after format; bug-level calls are mine.
- Subagents: Opus; I review for slop.

## Key Decisions
- Contract: `shared/types.ts` + `shared/api.ts` (written first, before agents) so desktop and client build in parallel.
- Conflict attention is derived, not stored: any tracked file matching `(conflict <host>, <date>)` → attention/conflict; clears when the copies are deleted (on every computer). Sync keeps running.
- Copy AI prompt texts live in the client only; notifications just open the folder.
- Tray artwork pre-rendered PNGs (build script, resvg) committed; no runtime SVG rendering.

## State
- Done:
  - [x] Linear tree YAZ-2001…2025 + scenario catalog
  - [x] Worktree `../github-autosync-yaz-1998`, branch `yaz-1998-initial-build`, main rooted (7f1fb82)
- Now: [→] 1 Deep scope (YAZ-2001) → 2A scaffold
- Next: 3 engine (desktop agent) ∥ 4 GUI (client agent)
- Remaining:
  - [ ] 2A scaffold, 2B shell
  - [ ] 3A–3F engine
  - [ ] 4A–4E GUI
  - [ ] 5A/5B automated proofs, 5C Yasin hands-on
  - [ ] 6A audit, 6B apply
  - [ ] Merge to main, Linear Done

## Open Questions
- (none)

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/github-autosync-yaz-1998`
- Draw source: `/Users/yasin/Documents/GitHub/yaseen-draw-app/desktop/src/main/git/` @ 89b29c9
- Demo: scratchpad `GitHub AutoSync Demo/index.html` (zip on YAZ-1998)
- Tests: `npm test`, `npm run typecheck`
