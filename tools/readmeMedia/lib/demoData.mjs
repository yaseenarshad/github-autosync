/**
 * The made-up world every README picture shows: one person ("sam"), three computers, eight folders
 * of everyday knowledge work, and about a week of syncs between them. Nothing here is real — no
 * real name, path, account or repository. `scenario()` turns it into what the demo preload
 * (demoApi.cjs) serves the real window as `window.autosync`.
 *
 * Time is fixed: the window's clock reads NOW (Tue 13 Oct 2026, 9:41 AM, local time), so every
 * "3m ago" and "Today" comes out the same on every run.
 */

export const NOW = new Date(2026, 9, 13, 9, 41, 0).getTime()
export const HOST = 'MacBook-Pro'
export const STUDIO = 'Mac-Studio'
export const OFFICE = 'Office-iMac'
const HOME = '/Users/sam'
const GITHUB = `${HOME}/Documents/GitHub`
const ORG = 'https://github.com/northwind-studio'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** A folder that is synced and quiet, under `dir`; `extra` changes what the scene needs. */
export function folder(name, dir, extra = {}) {
  return {
    id: name,
    path: `${dir}/${name}`,
    name,
    alias: null,
    enabled: true,
    state: 'synced',
    direction: null,
    attention: null,
    branch: 'main',
    remoteUrl: `${ORG}/${name}.git`,
    webUrl: `${ORG}/${name}`,
    repo: `${ORG}/${name}`.replace(/^https:\/\//, '').toLowerCase(),
    settings: { push: 'auto', pull: 1, paths: null, beforePush: null },
    publishVia: 'push',
    pr: null,
    pending: [],
    outside: [],
    tooBig: [],
    inUse: [],
    ignored: { patterns: ['.DS_Store', '.obsidian/workspace.json'], count: 4 },
    alsoSyncedBy: null,
    offline: false,
    lastSyncedAt: NOW - 3 * MIN,
    lastCheckedAt: NOW - 20 * SEC,
    pendingSince: null,
    sendAt: null,
    retryAt: null,
    pullAt: NOW + 40 * SEC,
    pausedUntil: null,
    ...extra,
  }
}

const TEAM = `${GITHUB}/northwind`

/** The eight folders, all green: four of sam's own, four the team shares. */
export function folders() {
  return [
    folder('ai-skills', GITHUB, { lastSyncedAt: NOW - 1 * MIN, ignored: { patterns: ['.DS_Store', '.venv/'], count: 212 } }),
    folder('meeting-notes', GITHUB, { lastSyncedAt: NOW - 6 * MIN }),
    folder('content-calendar', GITHUB, { lastSyncedAt: NOW - 14 * MIN }),
    folder('research', GITHUB, { lastSyncedAt: NOW - 52 * MIN }),
    folder('team-handbook', TEAM, { lastSyncedAt: NOW - 2 * MIN }),
    folder('client-notes', TEAM, { lastSyncedAt: NOW - 4 * MIN }),
    folder('marketing', TEAM, { lastSyncedAt: NOW - 9 * MIN }),
    folder('sops', TEAM, { lastSyncedAt: NOW - 26 * MIN }),
  ]
}

export function status(list = folders()) {
  return {
    folders: list,
    paused: false,
    gitMissing: false,
    hostname: HOST,
    launchAtLogin: true,
    theme: 'light',
    settingsFolder: '/Users/sam/Documents/GitHub/sam-os/Sync/github-autosync-settings',
    settingsFolderMissing: false,
    settingsFolderNote: null,
    others: [],
    computers: [],
    defaults: { push: 'auto', pull: 1 },
  }
}

/** `list` with the folder `id` changed by `change`. */
export const patch = (list, id, change) => list.map((f) => (f.id === id ? { ...f, ...change } : f))

// ---------------------------------------------------------------- activity (git history)
let shaSeed = 11
/** A stable, made-up 40-hex commit id. */
function sha() {
  let out = ''
  for (let i = 0; i < 5; i++) {
    shaSeed = (shaSeed * 16807) % 2147483647
    out += shaSeed.toString(16).padStart(8, '0').slice(0, 8)
  }
  return out
}
/** Today or `daysAgo` days back, at h:mm local time. */
const at = (daysAgo, h, m) => new Date(2026, 9, 13 - daysAgo, h, m).getTime()
const M = (path) => ({ status: 'M', path })
const A = (path) => ({ status: 'A', path })

function entry(time, host, files) {
  const kind = host === HOST ? 'sent' : 'received'
  return { sha: sha(), time, kind, host, subject: `sync (${host}): ${files.map((f) => f.path).join(', ')}`, files }
}

/** A week of the `ai-skills` folder, written on three computers. Newest first. */
export function aiSkillsLog() {
  shaSeed = 11
  return [
    entry(at(0, 9, 40), HOST, [M('meeting-summary/SKILL.md')]),
    entry(at(0, 9, 22), STUDIO, [M('writing-coach/SKILL.md'), A('writing-coach/references/tone-of-voice.md')]),
    entry(at(0, 9, 6), STUDIO, [M('writing-coach/SKILL.md')]),
    entry(at(0, 8, 47), HOST, [A('client-onboarding/SKILL.md'), A('client-onboarding/checklist.md')]),
    entry(at(0, 8, 12), OFFICE, [M('seo-brief/references/checklist.md')]),
    entry(at(1, 17, 52), HOST, [M('proposal-writer/SKILL.md'), M('proposal-writer/templates/one-pager.md')]),
    entry(at(1, 17, 44), HOST, [M('proposal-writer/templates/one-pager.md')]),
    entry(at(1, 17, 31), HOST, [A('proposal-writer/SKILL.md')]),
    entry(at(1, 15, 10), OFFICE, [M('README.md'), M('seo-brief/SKILL.md')]),
    entry(at(1, 11, 3), STUDIO, [M('meeting-summary/SKILL.md')]),
    entry(at(1, 10, 20), HOST, [M('writing-coach/SKILL.md')]),
    entry(at(2, 16, 40), STUDIO, [A('newsletter-draft/SKILL.md'), A('newsletter-draft/examples/october.md')]),
    entry(at(2, 14, 5), HOST, [M('seo-brief/SKILL.md')]),
    entry(at(2, 9, 58), OFFICE, [M('client-onboarding/SKILL.md')]),
    entry(at(3, 18, 12), HOST, [M('meeting-summary/examples/weekly-sync.md')]),
    entry(at(3, 13, 30), STUDIO, [M('writing-coach/references/tone-of-voice.md')]),
    entry(at(4, 11, 45), OFFICE, [A('seo-brief/references/checklist.md'), A('seo-brief/SKILL.md')]),
    entry(at(4, 10, 2), HOST, [A('meeting-summary/SKILL.md'), A('meeting-summary/examples/weekly-sync.md')]),
    entry(at(5, 15, 20), STUDIO, [A('writing-coach/SKILL.md')]),
    entry(at(6, 9, 15), HOST, [A('README.md')]),
  ]
}

/** The `client-notes` folder: the conflict on top, ordinary syncs under it. */
export function clientNotesLog(conflicts) {
  shaSeed = 23
  // This Mac replayed its edit on top of Mac-Studio's and kept its own version as the copy: a
  // commit that ADDS a keep-both copy is the conflict (desktop/src/main/git/activity.ts `classify`).
  const files = [...conflicts.map((c) => M(c.original)), ...conflicts.map((c) => A(c.copy))]
  return [
    { sha: sha(), time: NOW - 2 * MIN, kind: 'conflict', host: HOST, subject: `sync (${HOST}): ${files.map((f) => f.path).join(', ')}`, files },
    entry(at(0, 9, 12), STUDIO, [M('acme/kickoff-notes.md')]),
    entry(at(0, 8, 55), HOST, [M('acme/kickoff-notes.md'), A('acme/stakeholders.md')]),
    entry(at(1, 16, 30), OFFICE, [M('bluebird/weekly-update.md')]),
    entry(at(1, 11, 5), HOST, [A('acme/kickoff-notes.md')]),
  ]
}

/** The `team-handbook` folder, a team repo that takes changes only through pull requests. */
export function handbookLog() {
  shaSeed = 37
  return [
    entry(at(0, 8, 30), STUDIO, [M('policies/time-off.md')]),
    entry(at(1, 17, 5), HOST, [M('onboarding/tools.md'), M('onboarding/first-week.md')]),
    entry(at(1, 12, 40), OFFICE, [A('policies/expenses.md')]),
    entry(at(2, 15, 18), HOST, [M('README.md')]),
  ]
}

// ---------------------------------------------------------------- scenes
const CONFLICTS = [{ original: 'acme/kickoff-notes.md', copy: 'acme/kickoff-notes (conflict MacBook-Pro, 2026-10-13).md' }]

/**
 * What the window shows for one picture: `status`, `activity` per folder id, the folder the
 * (made-up) native picker returns, and the verdicts `checkFolder` gives.
 */
export function scenario(name) {
  const base = folders()
  const logs = { 'ai-skills': aiSkillsLog(), 'client-notes': clientNotesLog(CONFLICTS), 'team-handbook': handbookLog() }
  const pick = `${TEAM}/brand-guide`
  const verdicts = { [pick]: { ok: true, path: pick, warning: null, offline: false } }
  const scene = (list) => ({ now: NOW, status: status(list), activity: logs, pick, verdicts })
  switch (name) {
    case 'overview':
      return scene(patch(base, 'meeting-notes', { state: 'syncing', direction: 'up', pending: [M('2026/10/13-weekly-sync.md')] }))
    case 'history':
      return scene(base)
    case 'conflict':
      return scene(patch(base, 'client-notes', { state: 'attention', attention: { kind: 'conflict', conflicts: CONFLICTS }, lastSyncedAt: NOW - 2 * MIN }))
    case 'team-pr':
      return scene(
        patch(base, 'team-handbook', {
          state: 'pending',
          publishVia: 'pr',
          pr: { number: 12, url: `${ORG}/team-handbook/pull/12` },
          pending: [M('onboarding/first-week.md'), A('policies/remote-work.md')],
          pendingSince: NOW - 8 * MIN,
          lastSyncedAt: NOW - 3 * HOUR,
        }),
      )
    case 'add':
      return scene(base)
    case 'synced-now':
      return scene(patch(base, 'marketing', { lastSyncedAt: NOW - 2 * SEC }))
    default:
      throw new Error(`no scenario named ${name}`)
  }
}

export { SEC, MIN, HOUR, DAY }
