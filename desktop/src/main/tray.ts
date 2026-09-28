import { Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import type { AppStatus } from '@shared/types'
import { trayState, trayTemplate, type TrayActions } from './trayState'

/**
 * The menu bar status dot (D20). Its images are pre-rendered PNGs (`scripts/render-icons.mjs`), not
 * template images — a template image is one flat colour, and the dot has to stay green/amber/red.
 * The colours read on light and dark menu bars alike, so one set serves both.
 */
export function createTray(iconDir: string, actions: TrayActions & { openWindow(): void }): { update(status: AppStatus): void } {
  const image = (status: AppStatus) => nativeImage.createFromPath(path.join(iconDir, `tray-${trayState(status)}.png`))
  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('GitHub AutoSync')
  // Windows and Linux: a left click is "open the app"; the menu is on the right click. macOS always shows the menu.
  if (process.platform !== 'darwin') tray.on('click', () => actions.openWindow())

  function update(status: AppStatus): void {
    tray.setImage(image(status))
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(status, actions)))
  }
  return { update }
}
