# GitHub AutoSync

- Keeps chosen git folders in step across your computers: auto commits local changes, pulls the other computers' commits, pushes yours.
- Lives in the menu bar (Mac) / tray (Windows); the window lists folders, their status and activity.
- Electron + React: `desktop/` (main + preload), `client/` (renderer), `shared/` (types and the renderer ↔ main contract, `@shared/*`).

## Dev

- Requires Node.js 22+ and npm.
- `npm install` — once.
- `npm run dev` — launch the app with HMR.
- `npm test` — vitest (client: jsdom, desktop: node).
- `npm run typecheck`
- `npm run build` — electron-vite bundle into `desktop/out`.
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
