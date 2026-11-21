import { describe, expect, it } from 'vitest'
import { parseAddFolderUrl } from './deepLink'

describe('parseAddFolderUrl', () => {
  it('extracts an absolute path from github-autosync://add?path=...', () => {
    expect(parseAddFolderUrl('github-autosync://add?path=%2FUsers%2Fme%2Fvault')).toBe('/Users/me/vault')
  })

  it('rejects relative paths, other hosts, and other schemes', () => {
    expect(parseAddFolderUrl('github-autosync://add?path=relative/dir')).toBeNull()
    expect(parseAddFolderUrl('github-autosync://remove?path=%2FUsers%2Fme%2Fvault')).toBeNull()
    expect(parseAddFolderUrl('https://example.com/add?path=%2FUsers%2Fme%2Fvault')).toBeNull()
    expect(parseAddFolderUrl('not a url')).toBeNull()
  })
})
