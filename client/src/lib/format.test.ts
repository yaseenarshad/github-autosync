import { expect, it } from 'vitest'
import { formatBytes, homeDir, parentDir, tildify } from './format'

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
