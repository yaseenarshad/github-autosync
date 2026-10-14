<p align="center">
  <img src="docs/assets/banner.png" width="860" alt="GitHub AutoSync. GitHub for knowledge work. Your files sync themselves. Every change kept in git.">
</p>

<p align="center">
  <a href="https://github.com/yaseenarshad/github-autosync/releases/latest"><img src="https://img.shields.io/github/v/release/yaseenarshad/github-autosync?label=version&color=2ea043" alt="The newest version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/yaseenarshad/github-autosync?color=2ea043" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows-free-2ea043" alt="Free for macOS (Apple Silicon) and Windows">
</p>

<p align="center">
  <a href="https://github.com/yaseenarshad/github-autosync/releases/latest"><b>Download</b></a> ·
  <a href="#the-answer">How it works</a> ·
  <a href="#the-doubts">Questions</a> ·
  <a href="docs/DEVELOPMENT.md">Developers</a>
</p>

<p align="center">
  <b>Write it on one computer. It is already on your other one, and on your team's.<br>No commit. No push.</b>
</p>

<p align="center">
  <img src="docs/assets/hero.gif" width="860" alt="Two screens side by side: your laptop and your teammate's Mac, each with the same launch-plan.md open and a green dot in the menu bar. You type a new line on the laptop. Its dot turns amber, then blue, then green. Under a minute later the dot on the teammate's Mac turns blue, then green, and the new line is in their file.">
</p>

<p align="center">
  <a href="https://github.com/yaseenarshad/github-autosync/releases/latest"><b>Download for Mac or Windows</b></a><br>
  <sub>Free · Open source · Uses your own GitHub · No account, no server</sub>
</p>

## The problem

GitHub was built for code. For code, "nothing syncs until you push" is a feature: you want CI, and you want to know exactly what you ship. But I keep my knowledge work in GitHub too: notes, docs, SOPs, the skills of my AI agent. An agent works best on real files on your computer. And I kept forgetting to push. I sat down at my other computer, and the file was not there. My teammate opened the folder, and they did not have it either. So I built the Google Drive for your local files, on GitHub: you save, and every computer and every teammate has it.

Maybe you know these moments:

- You wrote the doc on your laptop. You open your desktop, and it is not there.
- Your teammate needs the file now. It is on your computer, not on GitHub.
- Your AI agent changed 40 files today. Nobody committed them.
- You tried Google Drive. Your files lived in the cloud, and old versions were gone after 30 days.

<p align="center">
  <img src="docs/assets/compare.png" width="860" alt="A comparison of Google Drive, GitHub (on its own), and GitHub AutoSync. Real files on your computer, agent native: Google Drive no, online-only by default; GitHub yes; AutoSync yes. Every version kept: Google Drive no, deleted after 30 days; GitHub yes; AutoSync yes. See what changed, line by line and which computer: Google Drive no, whole-file versions; GitHub yes; AutoSync yes. Syncs by itself, no commit and no push: Google Drive yes; GitHub no, you commit and push; AutoSync yes. Your team has it in a minute: Google Drive yes; GitHub no, only when someone pushes; AutoSync yes. Works with pull-request rules for team repos: Google Drive no, not git; GitHub yes; AutoSync yes. An AI prompt for every problem: Google Drive no; GitHub no; AutoSync yes. Open source: Google Drive no; GitHub yes; AutoSync yes.">
</p>

<p align="center"><sub>Google Drive: Drive for desktop in its default mode, and its version history for files that are not Google Docs (Google Drive Help, October 2026). GitHub (on its own): git or GitHub Desktop, where you commit and push yourself.</sub></p>

## The answer

GitHub AutoSync gives you the sync of Google Drive with the history of git. It watches the git folders that you pick. 30 seconds after you stop typing, it commits and pushes. Every minute, it brings in what the others sent.

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/assets/step-1.png" width="260" alt="The Add folder sheet of GitHub AutoSync, with a git folder picked and ready to sync"><br><b>1. Add a folder</b><br>Any git folder on GitHub.</td>
    <td align="center" width="33%"><img src="docs/assets/step-2.png" width="260" alt="An editor with a file that changes, and an amber dot in the menu bar"><br><b>2. Keep working</b><br>In any editor, or let your agent write.</td>
    <td align="center" width="33%"><img src="docs/assets/step-3.png" width="260" alt="A green dot in the menu bar, and the folder shows Synced just now"><br><b>3. It is on GitHub</b><br>The dot turns green.</td>
  </tr>
</table>

## What it does

### Green means done. Red means look.

One dot in your menu bar tells you everything. Bright green: every folder is on GitHub. Bright red: a folder needs you, and one click shows which.

**So what:** you never wonder again if your work is saved.

<p align="center">
  <img src="docs/assets/dot.png" width="860" alt="A menu bar with the four dots of GitHub AutoSync: green for synced, blue for syncing, amber for waiting, and red for needs you.">
</p>

### Every change kept, from every computer

Each save is a git commit with the name of the computer that sent it. Open a folder and see what went out, what came in, from where, and when.

**So what:** you can go back to any version, from any day. No 30-day limit. And your AI agent can read the history too.

<p align="center">
  <img src="docs/assets/history.png" width="860" alt="The folder page of GitHub AutoSync with a week of activity: changes sent from this Mac, and changes received from Mac-Studio and Office-iMac, each with its files and time.">
</p>

### Two people, one file: nothing is lost

When the same file changes on two computers, AutoSync keeps both versions side by side, and syncing goes on. One click copies a prompt that tells your AI agent how to merge them.

**So what:** no merge screen, no lost paragraph. Your agent does the cleanup.

<p align="center">
  <img src="docs/assets/conflict.png" width="860" alt="A folder in GitHub AutoSync that says a file changed on two computers and both versions are kept, with the Copy AI prompt button marked.">
</p>

### Works with your team's rules

Does your team repo take changes only through pull requests? AutoSync opens one pull request for each sitting, 5 minutes after your last edit. When the repo merges it, your folder turns green.

**So what:** the team keeps its review rules, and you still never type a git command.

<p align="center">
  <img src="docs/assets/team-pr.png" width="860" alt="A team folder in GitHub AutoSync that waits on its pull request to merge.">
</p>

### All your folders in one window

<p align="center">
  <img src="docs/assets/overview.png" width="860" alt="The All folders page of GitHub AutoSync with eight folders: seven synced and one that sends its changes.">
</p>

And the small things:

- It starts at login, and it leaves the Dock when you close its window.
- Right-click a folder to open it in Finder, Terminal, VS Code or on GitHub, or to give it a nickname.
- Your `.gitignore` decides what syncs. A file too big for GitHub is never sent, and the window lists it.
- Pause everything with one click.
- Light and dark look.

## The proof

- **30 seconds** after you stop typing, your change is on GitHub.
- **Every minute**, it checks for the changes of your other computers and your team.
- **360 automated tests** run against real git, on Mac and on Windows, for every pull request to the app.
- **0 accounts, 0 servers, 0 tracking.** The app talks only to your own GitHub, through git.
- **Never a merge commit.** Your history stays clean.

## The doubts

**Will it mess up my code repos?**
It syncs only the folders that you add. Keep your code repos out, and give it your knowledge folders. If you start a merge or a rebase by hand, it waits until you finish.

**Where do my files go?**
Only to your own repo on GitHub, through your own git. There is no AutoSync account and no AutoSync server.

**Does it cost money?**
No. It is free and open source, and private repos on GitHub are free.

**Why does my computer warn me at the first start?**
The app does not come from an app store, so macOS and Windows ask you one time. Step 4 below shows the one click.

## The download

<p align="center">
  <a href="https://github.com/yaseenarshad/github-autosync/releases/latest"><b>Download the newest version</b></a><br>
  <sub>Mac with Apple Silicon (<code>.dmg</code>) · Windows 64-bit (<code>-setup.exe</code>) · Needs git and the GitHub CLI</sub>
</p>

1. Install git and the GitHub CLI. Mac: `brew install git gh`. Windows: `winget install Git.Git`, then `winget install GitHub.cli`.
2. Sign in to GitHub: `gh auth login`, then `gh auth setup-git`.
3. Clone the repo that you want to sync.
4. Install and open GitHub AutoSync. On a Mac, the first time: System Settings → Privacy & Security → **Open Anyway**. On Windows: **More info** → **Run anyway**.
5. Click **Add folder** and pick the clone.

Then try this:

1. Change a file in that folder. Watch the dot turn amber, then green, in about 30 seconds.
2. Open the repo on GitHub. Your change is there as `sync (<your computer>): <file>`.
3. Add the same repo on your other computer, or give it to a teammate. Change a file there, and watch it arrive here.

## For developers

GitHub AutoSync is an Electron and React app, with a sync engine on plain git. How to build, test and release it: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Exactly how it behaves: [docs/CONTRACTS.md](docs/CONTRACTS.md).

Licence: [MIT](LICENSE).
