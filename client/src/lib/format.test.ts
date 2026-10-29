import { describe, expect, it } from 'vitest'
import { formatBytes, homeDir, parentDir, repoLabel, tildify } from './format'

it('finds the home folder on mac, linux and windows', () => {
  expect(homeDir('/Users/yasin/Documents/GitHub/notes')).toBe('/Users/yasin')
  expect(homeDir('/home/yasin/code/notes')).toBe('/home/yasin')
  expect(homeDir('C:\\Users\\yasin\\code\\notes')).toBe('C:\\Users\\yasin')
  expect(homeDir('/Volumes/Work/notes')).toBeNull()
  expect(homeDir(undefined)).toBeNull()
})

it('tildifies only under home', () => {
  expect(tildify('/Users/yasin/Documents/GitHub', '/Users/yasin')).toBe('~/Documents/GitHub')
  expect(tildify('/Volumes/Work', '/Users/yasin')).toBe('/Volumes/Work')
  expect(tildify('/Users/yasin/x', null)).toBe('/Users/yasin/x')
})

it('takes the parent of posix and windows paths', () => {
  expect(parentDir('/Users/yasin/Documents/GitHub/notes')).toBe('/Users/yasin/Documents/GitHub')
  expect(parentDir('C:\\Users\\yasin\\notes')).toBe('C:\\Users\\yasin')
})

it('formats sizes in MB, GB past 1024 MB', () => {
  expect(formatBytes(240 * 1024 ** 2)).toBe('240 MB')
  expect(formatBytes(1.4 * 1024 ** 3)).toBe('1.4 GB')
})

describe('repoLabel', () => {
  it('reads owner/repo from GitHub, and the last part of any other remote', () => {
    expect(repoLabel('https://github.com/GrowProfit-Engineering/ln-harness-lab')).toBe('GrowProfit-Engineering/ln-harness-lab')
    expect(repoLabel('git@github.com:me/notes.git')).toBe('me/notes')
    expect(repoLabel('/srv/git/ln-lab.git')).toBe('ln-lab')
  })
})
