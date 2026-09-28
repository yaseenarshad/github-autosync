import { Menu, nativeImage, nativeTheme, systemPreferences, Tray } from 'electron'
import path from 'node:path'
import type { AppStatus } from '@shared/types'
import { trayState, trayTemplate, trayVariant, type TrayActions } from './trayState'

/**
 * The menu bar octopus. Its images are pre-rendered PNGs (`scripts/render-icons.mjs`), not template
 * images — a template image is one flat colour, and the status dot has to stay green/amber/red —
 * so there are two sets and the menu bar's appearance picks one (`-dark` = white body, `trayVariant`).
 */
export function createTray(iconDir: string, actions: TrayActions & { openWindow(): void }): { update(status: AppStatus): void } {
  let last: AppStatus | null = null
  const variant = () =>
    trayVariant(process.platform, {
      appleInterfaceStyle: process.platform === 'darwin' ? systemPreferences.getUserDefault('AppleInterfaceStyle', 'string') : '',
      systemUiDark: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI,
    })
  const image = (status: AppStatus) => nativeImage.createFromPath(path.join(iconDir, `tray-${trayState(status)}-${variant()}.png`))
  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('GitHub AutoSync')
  // Windows and Linux: a left click is "open the app"; the menu is on the right click. macOS always shows the menu.
  if (process.platform !== 'darwin') tray.on('click', () => actions.openWindow())

  function update(status: AppStatus): void {
    last = status
    tray.setImage(image(status))
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(status, actions)))
  }
  const refreshImage = () => {
    if (last !== null) tray.setImage(image(last))
  }
  // The app's own `themeSource` (D19) does not move the menu bar; the OS appearance does.
  if (process.platform === 'darwin') systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', refreshImage)
  else nativeTheme.on('updated', refreshImage)
  return { update }
}
