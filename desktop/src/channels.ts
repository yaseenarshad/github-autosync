import type { AutoSyncApi } from '@shared/api'

/** The request/response half of `AutoSyncApi`; the two `on…` subscriptions are pushes instead. */
export type Invokable = Exclude<keyof AutoSyncApi, 'onStatus' | 'onNavigate'>

/** One invoke channel per API method, so main and preload can never disagree on a name. */
export const channel = (method: Invokable): string => `autosync:${method}`

export const STATUS_CHANNEL = 'autosync:status'
export const NAVIGATE_CHANNEL = 'autosync:navigate'
