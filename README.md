# GitHub AutoSync

- Keeps chosen git folders in step across your computers: auto commits local changes, pulls the other computers' commits, pushes yours.
- Lives in the menu bar (Mac) / tray (Windows); the window lists folders, their status and activity.
- Electron + React: `desktop/` (main + preload), `client/` (renderer), `shared/` (types, the renderer ↔ main contract and the shared status rules, `@shared/*`).
- How it behaves, in detail: [docs/CONTRACTS.md](docs/CONTRACTS.md).

## What it does to your repo

- Commits on whatever branch is checked out, as `sync (<this computer>): a.md, b.md +2 more`.
- Pulls by rebasing your unpushed commits onto GitHub's — never a merge commit.
- The same file changed on two computers: GitHub's version stays, yours is kept beside it as `<name> (conflict <computer>, <date>)<ext>`. Syncing keeps going.
- Files of 95 MiB or more are never committed (GitHub refuses them); they are listed as too big.
- A repo mid-rebase, mid-merge or on a detached HEAD is left alone until you finish.
- `.gitignore` is the only filter.
- Settings live in the app's own `config.json` (macOS: `~/Library/Application Support/GitHub AutoSync/`); nothing is written into your folders.

## Dev

- Requires Node.js 22+ and npm.
- `npm install` — once.
- `npm run dev` — launch the app with HMR. `AUTOSYNC_USER_DATA=/tmp/autosync-profile npm run dev` uses a throwaway profile.
- `npm run dev -w client` — the window alone in a browser, on a seeded fake API (no Electron, no git).
- `npm test` — vitest (client: jsdom, desktop: node).
- `npm run typecheck`
- `npm run build` — electron-vite bundle into `desktop/out`.
- `npm run icons -w desktop` — re-render the tray and app icon PNGs after editing `desktop/build/*.svg`.
- `npm run pack` — build, then electron-builder for this platform into `desktop/dist-app` (mac: arm64 dmg, ad-hoc signed; win: x64 NSIS installer, unsigned).

## One-time setup per computer

- `gh auth login`
- `gh auth setup-git` (git uses the GitHub CLI's credentials for push/pull)
- Clone the repo you want synced.
- Open GitHub AutoSync → **Add folder** → pick the clone.

## Releases

- No release is cut automatically.
- Tag `vX.Y.Z` and push the tag to build installers: `.github/workflows/release.yml` attaches the mac dmg and the Windows setup exe to that GitHub release.
- The app version is `desktop/package.json` `version`.
