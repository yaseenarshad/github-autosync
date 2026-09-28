// Copied from yaseen-draw-app@89b29c9 desktop/src/main/git/resolve.ts; changes: keep-both only (no board/config merges, no Merged-with trailer, no before-merge ref), host in the copy name, versions moved by rename.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { git, zList } from './exec'

/**
 * D6 KEEP-BOTH: a `rebase @{u}` that stopped on conflicts is settled file by file and finished,
 * so two computers editing the same file never stops the folder syncing and no `<<<<<<<` marker
 * ever lands in a user's file.
 *
 *  - both sides have the file: GitHub's version (already on every other computer) stays at the
 *    path, this computer's goes beside it as `<name> (conflict <host>, <YYYY-MM-DD>)<ext>`;
 *  - one side deleted it, the other changed it: the side with content stays at the path.
 *
 * Stage numbers inside a rebase are easy to get backwards: 2 ("ours") is the UPSTREAM being
 * replayed onto, 3 ("theirs") is the local commit being replayed. Every version is written by git
 * itself (`checkout-index --temp`) and moved into place with a rename, so a binary file or a large
 * one never passes through a string or a stdout buffer.
 *
 * Anything unexpected — a git step that fails, a stop that is not a conflict — aborts the rebase,
 * and git puts the working tree back as it was. A save the user made WHILE the rebase was stopped
 * would be reset away by that abort (and blocks `--continue`), so dirty tracked files are parked by
 * copy first and written back when the rebase is over, landed or not.
 */

/** Settles a stopped rebase and continues it to the end. True when it landed; false after aborting. */
export async function resolveRebase(bin: string, root: string, host: string, now: Date = new Date()): Promise<boolean> {
  const parked = new Map<string, Buffer | null>()
  const copies = new Map<string, string>()
  let landed = false
  try {
    for (;;) {
      // `--unmerged` lines are `<mode> <sha> <stage>\t<path>`, one per stage present.
      const conflicted = [...new Set(zList(await git(bin, root, ['ls-files', '-z', '--unmerged'])).map((line) => line.slice(line.indexOf('\t') + 1)))]
      if (conflicted.length === 0) return false // stopped for something that is not a conflict
      for (const rel of conflicted) {
        const staged = await keepBoth(bin, root, rel, copies, host, now)
        if (staged === null) return false
        if ((await git(bin, root, ['add', '-A', '--', ...staged.map((p) => `:(literal)${p}`)])).code !== 0) return false
      }
      await park(bin, root, parked) // as late as possible: a save landing after this is the abort path's to park
      // A resolution identical to the upstream (their edit kept, our delete dropped) leaves nothing to
      // commit, and `--continue` refuses an empty pick — that one is skipped instead.
      const empty = (await git(bin, root, ['diff', '--cached', '--quiet'])).code === 0
      const step = await git(bin, root, ['rebase', empty ? '--skip' : '--continue'])
      if (step.code === 0) break
      if (zList(await git(bin, root, ['ls-files', '-z', '--unmerged'])).length === 0) return false
    }
    landed = true
    return true
  } finally {
    if (!landed) {
      await park(bin, root, parked)
      // Its own exit code is ignored: if even the abort failed there is nothing more a pass can do.
      await git(bin, root, ['rebase', '--abort'])
    }
    await unpark(root, parked)
  }
}

const abs = (root: string, rel: string): string => path.join(root, ...rel.split('/'))

/** Settles one conflicted path on disk; answers the paths to stage, or null when it cannot. */
async function keepBoth(bin: string, root: string, rel: string, copies: Map<string, string>, host: string, now: Date): Promise<string[] | null> {
  const res = await git(bin, root, ['checkout-index', '--stage=all', '--temp', '--', rel])
  if (res.code !== 0) return null
  // `<base> <ours> <theirs>\t<path>`, `.` where a stage is absent; the temp files sit in the repo root.
  const temps = (res.stdout.split('\t')[0] ?? '').trim().split(' ').map((name) => (name === '.' ? null : path.join(root, name)))
  if (temps.length !== 3) return null
  const [base, upstream, local] = temps
  if (base) await rm(base, { force: true })
  await mkdir(path.dirname(abs(root, rel)), { recursive: true })
  if (upstream && local) {
    const copy = copies.get(rel) ?? freeCopyName(root, rel, host, now)
    copies.set(rel, copy)
    await rename(upstream, abs(root, rel))
    await rename(local, abs(root, copy))
    return [rel, copy]
  }
  const kept = upstream ?? local
  if (!kept) return null
  await rename(kept, abs(root, rel))
  return [rel]
}

/** `a/Note.md` → `a/Note (conflict Mac-A, 2026-09-27).md`, numbered past anything already there. */
function freeCopyName(root: string, rel: string, host: string, now: Date): string {
  const dir = path.posix.dirname(rel)
  const ext = path.posix.extname(rel)
  const stem = path.posix.basename(rel, ext)
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  for (let n = 1; ; n += 1) {
    const name = `${stem} (conflict ${host}, ${day}${n === 1 ? '' : ` ${n}`})${ext}`
    const candidate = dir === '.' ? name : `${dir}/${name}`
    if (!existsSync(abs(root, candidate))) return candidate
  }
}

/** Dirty tracked files — a save that landed mid-rebase — held by copy and checked out, so nothing git does next can reset them away. */
async function park(bin: string, root: string, parked: Map<string, Buffer | null>): Promise<void> {
  const dirty = zList(await git(bin, root, ['ls-files', '-z', '--modified']))
  if (dirty.length === 0) return
  for (const rel of dirty) parked.set(rel, await readFile(abs(root, rel)).catch(() => null))
  await git(bin, root, ['checkout', '--', ...dirty.map((p) => `:(literal)${p}`)])
}

/** The parked saves back on disk (a deleted one deleted again). The next pass commits them. */
async function unpark(root: string, parked: Map<string, Buffer | null>): Promise<void> {
  for (const [rel, bytes] of parked) {
    const file = abs(root, rel)
    if (bytes === null) {
      await rm(file, { force: true })
    } else {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)
    }
  }
}
