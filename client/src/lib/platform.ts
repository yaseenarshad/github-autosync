/** Mac vs everything else (Windows): the words and shortcuts the UI uses for this computer. */
export interface Platform {
  mac: boolean
  /** "this Mac" / "this computer" */
  here: string
  /** "your Mac" / "your computer" */
  yours: string
  /** "Mac" / "computer" */
  machine: string
  fileManager: string
  /** Where the app icon lives. */
  bar: string
  terminal: string
  /** Cmd/Ctrl + Shift + key, as shown to the user. */
  shortcut: (key: string) => string
}

export function platformFor(userAgent: string): Platform {
  return /Mac/.test(userAgent)
    ? {
        mac: true,
        here: 'this Mac',
        yours: 'your Mac',
        machine: 'Mac',
        fileManager: 'Finder',
        bar: 'menu bar',
        terminal: 'Terminal',
        shortcut: (key) => `⌘⇧${key}`,
      }
    : {
        mac: false,
        here: 'this computer',
        yours: 'your computer',
        machine: 'computer',
        fileManager: 'File Explorer',
        bar: 'tray',
        terminal: 'a terminal',
        shortcut: (key) => `Ctrl+Shift+${key}`,
      }
}

export const platform = platformFor(navigator.userAgent)
