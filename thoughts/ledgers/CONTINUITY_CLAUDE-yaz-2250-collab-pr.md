# YAZ-2250 Collab Mode + PR — GitHub AutoSync

## Goal
- A folder whose GitHub default branch requires PRs publishes itself hands-off: one immutable branch + PR per editing sitting, merged by the repo's Action, landed locally with `rebase --onto`. Push-mode folders unchanged.
- Done = typecheck + vitest + build green, 5C real-GitHub proof, Yasin's 5D hands-on, 6A/6B polish, merged to `main`, pushed, new release cut (smallest bump) with notes on every release, app on this Mac replaced, every Linear issue Done.

## Constraints
- No Playwright / browser automation, ever (agents included). Yasin tests by hand when told exactly what to do.
- Commits via the /commit skill (no attribution). Merge to `main` and push allowed at the end.
- Architecture questions go to Yasin in the decision format; bugs are decided in-run.
- Subagents: Opus; lead reviews every diff for slop.

## Key Decisions
- D21–D29 + scenario catalog S1–S32 are comments on YAZ-2250 — read those first.
- Seam: `desktop/src/main/git/github.ts` (`GitHub.repo(remoteUrl)`); tests use `fakeGitHub` in `gitFixture.ts` (real squash into the bare remote), because a node "fake gh" binary can't run under `execFile` on Windows CI.
- Branch name `autosync/<sha12>` (derivable from `refs/autosync/in-flight` alone).
- Acceptance suite written first: `desktop/src/main/git/pullRequest.test.ts`.

## State
- Done:
  - [x] 1 Deep scope (YAZ-2251) — build map comment
  - [x] 2 Recover stranded branch (YAZ-2252) — skills-growprofit-eng PR #4 merged, checkout on main
- Now: [→] 3A–3D engine (Opus agent) + 4A/4B GUI (Opus agent), in parallel in this worktree
- Remaining:
  - [ ] Review both agents' diffs; full typecheck/test/build
  - [ ] 5A/5B automated proofs (mostly the acceptance suite) — post evidence
  - [ ] 5C real GitHub proof: private throwaway repo in GrowProfit-Engineering (approved), same ruleset + publish.yml; delete after
  - [ ] 5D Yasin hands-on with exact steps
  - [ ] 6A audit, 6B apply
  - [ ] Commit, merge, push; release (smallest bump), release notes for every release, replace installed app

## Open Questions
- UNCONFIRMED: `gh pr close --delete-branch` run outside the repo (cwd = fs root) deletes only the remote branch.

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/github-autosync-yaz-2250`, branch `yaz-2250-collab-pr` (from `main` c987f9c).
- Test: `npm run typecheck`, `npm test`, `npm run build`.
- Linear helpers: scratchpad `lin.py`, `st.py <progress|done> YAZ-…`, `cm.py YAZ-… file.md`.
