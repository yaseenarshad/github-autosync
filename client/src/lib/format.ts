/** "240 MB", "1.4 GB" */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 ** 2
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

/** The home folder the added folders live under (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`), taken from one of their paths. */
export function homeDir(path: string | undefined): string | null {
  return path?.match(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/)?.[1] ?? null
}

/** `/Users/yasin/Documents/x` → `~/Documents/x` */
export function tildify(path: string, home: string | null): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function parentDir(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
}

/** `https://github.com/owner/repo` → `github.com/owner/repo` */
export function webLabel(webUrl: string): string {
  return webUrl.replace(/^https:\/\//, '')
}
