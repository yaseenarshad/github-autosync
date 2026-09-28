import { describe, expect, it } from 'vitest'
import { isGithubUrl, throttle } from './ipc'

describe('isGithubUrl', () => {
  it('opens GitHub pages and nothing else', () => {
    expect(isGithubUrl('https://github.com/yaseen/notes')).toBe(true)
    expect(isGithubUrl('https://github.com.evil.com/x')).toBe(false)
    expect(isGithubUrl('http://github.com/yaseen/notes')).toBe(false)
    expect(isGithubUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('throttle', () => {
  it('collapses a burst into one trailing call, then allows the next one', async () => {
    let calls = 0
    const fire = throttle(() => {
      calls += 1
    }, 20)
    for (let i = 0; i < 10; i += 1) fire()
    expect(calls).toBe(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(1)
    fire()
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(2)
  })
})
