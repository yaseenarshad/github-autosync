import { useSyncExternalStore } from 'react'
import { ago, countdown, stamp } from '../lib/time'

// One shared ticker for every live time on screen, running only while something is subscribed.
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}

/** "3m ago" */
export function Ago({ at }: { at: number }) {
  return <>{ago(at, useNow())}</>
}

/** "5:51 PM (3m ago)" */
export function Stamp({ at }: { at: number }) {
  return <>{stamp(at, useNow())}</>
}

/** "0:23" until `at` */
export function Countdown({ at }: { at: number }) {
  return <>{countdown(at, useNow())}</>
}

/** "Last synced 5:51 PM (3m ago)" */
export function LastSynced({ at }: { at: number | null }) {
  return at === null ? (
    <>Not synced yet</>
  ) : (
    <>
      Last synced <Stamp at={at} />
    </>
  )
}
