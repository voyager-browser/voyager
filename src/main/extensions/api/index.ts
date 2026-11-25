import { registerAccessibilityFeatures } from './accessibilityFeatures'
import { registerAlarms, restoreAlarms } from './alarms'
import { registerBookmarks } from './bookmarks'
import { registerBrowsingData } from './browsingData'
import { registerCommands } from './commands'
import { registerContextMenus } from './contextMenus'
import { registerCookies } from './cookies'
import { registerDownloads } from './downloads'
import { registerStorageApi } from './storageApi'
import { registerI18n } from './i18n'

let registered = false

/** Register every emulated extension API namespace exactly once. */
export function registerExtensionApis(): void {
  if (registered) return
  registered = true
  registerAccessibilityFeatures()
  registerAlarms()
  restoreAlarms()
  registerBookmarks()
  registerBrowsingData()
  registerCookies()
  registerI18n()
  registerCommands()
  registerContextMenus()
  registerStorageApi()
  registerDownloads()
}

export { refreshCommandShortcuts } from './commands'

export { invokeExtensionApi } from './registry'
