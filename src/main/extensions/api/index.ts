import { registerAccessibilityFeatures } from './accessibilityFeatures'
import { registerAlarms, restoreAlarms } from './alarms'
import { registerBookmarks } from './bookmarks'
import { registerBrowsingData } from './browsingData'
import { registerCommands } from './commands'
import { registerContentSettings } from './contentSettings'
import { registerContextMenus } from './contextMenus'
import { registerCookies } from './cookies'
import { registerDownloads } from './downloads'
import { registerHistory } from './history'
import { registerIdle } from './idle'
import { registerNotifications } from './notifications'
import { registerProxy } from './proxy'
import { registerSearch } from './search'
import { registerSessions } from './sessions'
import { registerStorageApi } from './storageApi'
import { registerSystemCpu } from './systemCpu'
import { registerSystemDisplay } from './systemDisplay'
import { registerSystemMemory } from './systemMemory'
import { registerTopSites } from './topSites'
import { registerTts } from './tts'
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
  registerContentSettings()
  registerContextMenus()
  registerStorageApi()
  registerDownloads()
  registerHistory()
  registerIdle()
  registerNotifications()
  registerProxy()
  registerSearch()
  registerSessions()
  registerTts()
  registerSystemCpu()
  registerSystemDisplay()
  registerSystemMemory()
  registerTopSites()
}

export { refreshCommandShortcuts } from './commands'

export { invokeExtensionApi } from './registry'
