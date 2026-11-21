import path from 'node:path'

/**
 * Parses `github-autosync://add?path=<absPath>` deep links (YAZ-6190, D3).
 * Returns the normalized absolute folder path, or null for any malformed/non-absolute link.
 */
export function parseAddFolderUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'github-autosync:' || parsed.hostname !== 'add') return null
    const rawPath = parsed.searchParams.get('path')
    if (rawPath === null || rawPath.trim() === '' || !path.isAbsolute(rawPath)) return null
    return path.resolve(rawPath)
  } catch {
    return null
  }
}
