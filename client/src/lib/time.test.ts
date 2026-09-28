import { describe, expect, it } from 'vitest'
import { ago, countdown, dayName, exact, HOUR, MINUTE, SECOND, stamp } from './time'

const now = new Date(2026, 8, 27, 17, 54).getTime()

describe('exact', () => {
  it('shows only the time today', () => {
    expect(exact(new Date(2026, 8, 27, 17, 51).getTime(), now)).toBe('5:51 PM')
  })
  it('says Yesterday by calendar day', () => {
    expect(exact(new Date(2026, 8, 26, 16, 12).getTime(), now)).toBe('Yesterday 4:12 PM')
    expect(exact(new Date(2026, 8, 26, 23, 59).getTime(), new Date(2026, 8, 27, 0, 5).getTime())).toBe('Yesterday 11:59 PM')
  })
  it('shows the date further back', () => {
    expect(exact(new Date(2026, 8, 25, 9, 3).getTime(), now)).toBe('Sep 25, 9:03 AM')
  })
})

describe('ago', () => {
  it.each([
    [5 * SECOND, 'just now'],
    [42 * SECOND, '42s ago'],
    [3 * MINUTE + 20 * SECOND, '3m ago'],
    [2 * HOUR + 59 * MINUTE, '2h ago'],
    [3 * 24 * HOUR + HOUR, '3d ago'],
  ])('%i ms → %s', (d, text) => {
    expect(ago(now - d, now)).toBe(text)
  })
  it('never goes negative for clock skew', () => {
    expect(ago(now + 5 * SECOND, now)).toBe('just now')
  })
})

it('stamp combines exact and relative', () => {
  expect(stamp(now - 3 * MINUTE, now)).toBe('5:51 PM (3m ago)')
})

describe('dayName', () => {
  it('names today, yesterday, then weekday + date', () => {
    expect(dayName(now - HOUR, now)).toBe('Today')
    expect(dayName(new Date(2026, 8, 26, 9).getTime(), now)).toBe('Yesterday')
    expect(dayName(new Date(2026, 8, 25, 9).getTime(), now)).toBe('Friday, Sep 25')
  })
})

describe('countdown', () => {
  it('rounds up to whole seconds as m:ss', () => {
    expect(countdown(now + 22_100, now)).toBe('0:23')
    expect(countdown(now + 102 * SECOND, now)).toBe('1:42')
  })
  it('stops at 0:00', () => {
    expect(countdown(now - SECOND, now)).toBe('0:00')
  })
})
