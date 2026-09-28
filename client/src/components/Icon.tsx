import type { CSSProperties } from 'react'

export type IconName =
  | 'sync'
  | 'check'
  | 'alert'
  | 'clock'
  | 'pause'
  | 'play'
  | 'up'
  | 'down'
  | 'plus'
  | 'gear'
  | 'folder'
  | 'branch'
  | 'ext'
  | 'copy'
  | 'search'
  | 'chev'
  | 'grid'
  | 'wifi-off'
  | 'trash'
  | 'computer'
  | 'logo-octopus'

export function Icon({ name, className = 'ico', style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

/** Rendered once; every <Icon> points into it. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-sync" viewBox="0 0 16 16">
          <path d="M13.6 6.2A5.8 5.8 0 0 0 3 4.6" />
          <path d="M2.4 9.8A5.8 5.8 0 0 0 13 11.4" />
          <path d="M3 1.8v2.8h2.8" />
          <path d="M13 14.2v-2.8h-2.8" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 16 16">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </symbol>
        <symbol id="i-alert" viewBox="0 0 16 16">
          <path d="M8 1.8l6.5 11.4H1.5z" />
          <path d="M8 6.2v3.3" />
          <path d="M8 11.6v.1" />
        </symbol>
        <symbol id="i-clock" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8V8l2.2 1.5" />
        </symbol>
        <symbol id="i-pause" viewBox="0 0 16 16">
          <path d="M6 3.5v9M10 3.5v9" />
        </symbol>
        <symbol id="i-play" viewBox="0 0 16 16">
          <path d="M5 3.2l8 4.8-8 4.8z" />
        </symbol>
        <symbol id="i-up" viewBox="0 0 16 16">
          <path d="M8 13V3M4 7l4-4 4 4" />
        </symbol>
        <symbol id="i-down" viewBox="0 0 16 16">
          <path d="M8 3v10M4 9l4 4 4-4" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 16 16">
          <path d="M8 3v10M3 8h10" />
        </symbol>
        <symbol id="i-gear" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
        </symbol>
        <symbol id="i-folder" viewBox="0 0 16 16">
          <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.3l1.5 1.6H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
        </symbol>
        <symbol id="i-branch" viewBox="0 0 16 16">
          <circle cx="4.5" cy="3.5" r="1.5" />
          <circle cx="4.5" cy="12.5" r="1.5" />
          <circle cx="11.5" cy="5.5" r="1.5" />
          <path d="M4.5 5v6M11.5 7c0 2.5-2.5 3-6.2 4.2" />
        </symbol>
        <symbol id="i-ext" viewBox="0 0 16 16">
          <path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3" />
        </symbol>
        <symbol id="i-copy" viewBox="0 0 16 16">
          <rect x="5" y="5" width="8.5" height="8.5" rx="1.3" />
          <path d="M11 5V3.5c0-.6-.4-1-1-1H3.5c-.6 0-1 .4-1 1V10c0 .6.4 1 1 1H5" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.3" />
          <path d="M10.2 10.2l3.3 3.3" />
        </symbol>
        <symbol id="i-chev" viewBox="0 0 16 16">
          <path d="M4 6l4 4 4-4" />
        </symbol>
        <symbol id="i-grid" viewBox="0 0 16 16">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </symbol>
        <symbol id="i-wifi-off" viewBox="0 0 16 16">
          <path d="M2 2l12 12" />
          <path d="M1.5 6.2A10 10 0 0 1 5 4.3M8 4a10 10 0 0 1 6.5 2.2M4 9a5.5 5.5 0 0 1 2.2-1.3M10.5 8.2A5.5 5.5 0 0 1 12 9" />
          <path d="M8 12.3v.1" />
        </symbol>
        <symbol id="i-trash" viewBox="0 0 16 16">
          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
        </symbol>
        <symbol id="i-computer" viewBox="0 0 16 16">
          <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1" />
          <path d="M5.5 13.8h5M8 11v2.8" />
        </symbol>
        <symbol id="i-logo-octopus" viewBox="0 0 32 32">
          <path
            fill="currentColor"
            stroke="none"
            fillRule="evenodd"
            d="M8.5 16.5C8.5 9.5 11.8 4.5 16 4.5S23.5 9.5 23.5 16.5Z M11.8 12.2a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0Z M16.8 12.2a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0Z"
          />
          <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M13.6 16.5C13.4 20 12.2 22.6 12.6 26" />
            <path d="M18.4 16.5C18.6 20 19.8 22.6 19.4 26" />
            <path d="M10 16C7 18.5 3.6 18.4 3.4 14.6C3.2 11.6 5.6 10.4 7.2 11.4" />
            <path d="M22 16C25 18.5 28.4 18.4 28.6 14.6C28.8 11.6 26.4 10.4 24.8 11.4" />
          </g>
        </symbol>
      </defs>
    </svg>
  )
}
