import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const desktop = fileURLToPath(new URL('../../', import.meta.url))
const pkg = JSON.parse(readFileSync(`${desktop}package.json`, 'utf8'))

it('packages an ad-hoc signed mac app under the GitHub AutoSync identity', () => {
  expect(pkg.build.appId).toBe('com.yaseenarshad.githubautosync')
  expect(pkg.build.productName).toBe('GitHub AutoSync')
  expect(pkg.build.mac.identity).toBeNull()
  expect(existsSync(`${desktop}${pkg.build.afterPack}`)).toBe(true)
})
