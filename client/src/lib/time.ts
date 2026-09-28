export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Calendar days, not 24 h spans: 11:50 PM yesterday is "Yesterday" at 12:05 AM.
function daysBefore(t: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(t)) / DAY)
}

/** "5:51 PM" */
export function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "5:51 PM" today, "Yesterday 4:12 PM", "Sep 25, 9:03 AM". */
export function exact(t: number, now: number): string {
  const days = daysBefore(t, now)
  if (days === 0) return clock(t)
  if (days === 1) return `Yesterday ${clock(t)}`
  return `${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock(t)}`
}

/** "just now", "42s ago", "3m ago", "2h ago", "3d ago". */
export function ago(t: number, now: number): string {
  const d = Math.max(0, now - t)
  if (d < 10 * SECOND) return 'just now'
  if (d < MINUTE) return `${Math.floor(d / SECOND)}s ago`
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  return `${Math.floor(d / DAY)}d ago`
}

/** "5:51 PM (3m ago)" */
export function stamp(t: number, now: number): string {
  return `${exact(t, now)} (${ago(t, now)})`
}

/** "Today", "Yesterday", "Friday, Sep 25". */
export function dayName(t: number, now: number): string {
  const days = daysBefore(t, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Time left until `at` as "m:ss"; "0:00" once it has passed. */
export function countdown(at: number, now: number): string {
  const s = Math.max(0, Math.ceil((at - now) / SECOND))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
