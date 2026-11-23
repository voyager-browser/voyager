import type { WebContents } from 'electron'
import type { WindowController } from './WindowController'

const controllers = new Set<WindowController>()
let active: WindowController | null = null

/** Track a browser window and make it active when focused. */
export function registerWindow(controller: WindowController): void {
  controllers.add(controller)
  active = controller
  controller.window.on('focus', () => {
    active = controller
  })
  controller.chrome.webContents.on('focus', () => {
    active = controller
  })
  controller.window.on('closed', () => {
    controllers.delete(controller)
    if (active === controller) {
      const remaining = [...controllers]
      active = remaining[remaining.length - 1] ?? null
    }
  })
}

export function activeWindow(): WindowController | null {
  return active
}

export function allWindows(): WindowController[] {
  return [...controllers]
}

/**
 * Resize the chrome layout of every window on a profile when the profile-wide
 * bookmarks-bar visibility changes. Bookmark state is shared by the whole
 * profile, so a per-window callback would leave other windows' chrome views at
 * the old height and clip the bar mounted by their renderers.
 */
export function setBookmarksBarVisibleForProfile(profileId: string, visible: boolean): void {
  for (const controller of controllers) {
    if (controller.profile === profileId) controller.setBookmarksBarVisible(visible)
  }
}

/** Find the window that owns a tab webContents. */
export function windowForWebContents(webContents: WebContents): WindowController | null {
  for (const controller of controllers) {
    if (controller.tabs.tabIdForWebContents(webContents)) return controller
  }
  return null
}

/** Find the window that owns a chrome or tab webContents. */
export function windowForAnyWebContents(
  webContents: WebContents | undefined | null
): WindowController | null {
  if (!webContents) return null
  for (const controller of controllers) {
    if (
      controller.chrome.webContents === webContents ||
      controller.tabs.tabIdForWebContents(webContents)
    ) {
      return controller
    }
  }
  return null
}
