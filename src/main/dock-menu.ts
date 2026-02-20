import { Menu, app } from 'electron'
import { createWindow, canCreateWindow } from './window-manager'

export function setupDockMenu(): void {
  const dockMenu = Menu.buildFromTemplate([
    {
      label: '新しいウィンドウ',
      click: (): void => {
        if (canCreateWindow()) {
          createWindow()
        }
      }
    }
  ])

  app.dock?.setMenu(dockMenu)
}
