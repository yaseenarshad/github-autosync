// "Copy AI prompt" texts: pasted into an AI assistant that has a terminal, so each one names the exact folder and remote.
import type { Attention, FolderStatus } from '@shared/types'
import { formatBytes } from './format'

const where = (f: FolderStatus) => `the git folder ${f.path} (remote origin: ${f.remoteUrl ?? 'not set'})`

const GH_LOGIN =
  'Install the GitHub CLI if it is missing (Mac: "brew install gh", Windows: "winget install --id GitHub.cli"), ' +
  'run "gh auth login" (GitHub.com, HTTPS, log in with a browser), then run "gh auth setup-git" so git uses those credentials.'

export function gitMissingPrompt(): string {
  return (
    'GitHub AutoSync says git is not installed on this computer. Install it: on a Mac run "xcode-select --install"; ' +
    'on Windows install Git for Windows ("winget install --id Git.Git -e"). ' +
    'Then confirm "git --version" works in a new terminal and that user.name and user.email are set globally.'
  )
}

export function attentionPrompt(f: FolderStatus, a: Attention): string {
  switch (a.kind) {
    case 'conflict':
      return (
        `In ${where(f)}, these files were edited on two computers and GitHub AutoSync kept both versions. ` +
        'For each pair, merge the "conflict" copy into the original file (keep everything that matters from both), then delete the conflict copy:\n' +
        (a.conflicts ?? []).map((p) => `- ${p.original}  ←  ${p.copy}`).join('\n')
      )
    case 'auth':
      return (
        `In ${where(f)}, git push/pull fails because GitHub refused the sign-in` +
        (a.detail ? `:\n${a.detail}\n\n` : '. ') +
        `Fix git's saved GitHub credentials so it works without a password prompt. ${GH_LOGIN} ` +
        `Confirm with "git ls-remote origin" in ${f.path}.`
      )
    case 'no-git':
      return `${gitMissingPrompt()} (It is needed to sync ${where(f)}.)`
    case 'no-identity':
      return (
        `GitHub AutoSync can't commit in ${where(f)} because git doesn't know my name and email. ` +
        'Set them globally with "git config --global user.name" and "git config --global user.email" ' +
        '(use my GitHub account\'s name and email — ask me if you\'re not sure), then confirm with "git config --global --list".'
      )
    case 'busy-repo':
      if (a.detail === 'detached') {
        return (
          `In ${where(f)}, git is in "detached HEAD" (not on a branch), so GitHub AutoSync won't touch it. ` +
          'Look at "git status" and "git log", put the folder back on its branch without losing any commits or changes ' +
          '(save stray commits on a branch and merge them if needed), and leave it with a clean status.'
        )
      }
      return (
        `In ${where(f)}, git says a ${a.detail === 'merge' ? 'merge' : 'rebase'} is in progress, so GitHub AutoSync won't touch it. ` +
        `Look at "git status", then either finish the ${a.detail === 'merge' ? 'merge' : 'rebase'} or abort it safely — without losing any changes — ` +
        'and leave the folder on its branch with a clean status.'
      )
    case 'error':
      return (
        `GitHub AutoSync hit a git error in ${where(f)}` +
        (a.detail ? `:\n${a.detail}\n\n` : '. ') +
        'Find out what caused it and fix it without losing any changes, then leave the folder on its branch with a clean status.'
      )
  }
}

export function tooBigPrompt(f: FolderStatus): string {
  return (
    `In ${where(f)}, these files are too big for GitHub (it rejects files over 100 MB), so GitHub AutoSync never commits them:\n` +
    f.tooBig.map((t) => `- ${t.path} (${formatBytes(t.bytes)})`).join('\n') +
    '\nFor each one, either add it to .gitignore or set it up with Git LFS — recommend which, then do it.'
  )
}

/** Add-folder rejections (D12): the folder isn't in AutoSync yet, so only its path is known. */
export function noOriginPrompt(path: string): string {
  return (
    `The git folder ${path} has no remote named "origin", so GitHub AutoSync has nowhere to sync it. ` +
    'Create a private GitHub repo with the same name using the GitHub CLI and set it as origin ' +
    '("gh repo create --private --source . --remote origin --push"), or add the existing GitHub repo as origin and push the current branch.'
  )
}

export function loginPrompt(path: string): string {
  return (
    `GitHub AutoSync can't reach the remote origin of the git folder ${path} because GitHub login isn't set up for git on this computer. ` +
    `${GH_LOGIN} Confirm with "git ls-remote origin" in ${path}.`
  )
}
