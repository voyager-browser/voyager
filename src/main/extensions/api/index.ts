import { registerAccessibilityFeatures } from './accessibilityFeatures'
import { registerAlarms, restoreAlarms } from './alarms'
import { registerBookmarks } from './bookmarks'
import { registerBrowsingData } from './browsingData'
import { registerCommands } from './commands'
import { registerContentSettings } from './contentSettings'
import { registerContextMenus } from './contextMenus'
import { registerCookies } from './cookies'
import { registerDeclarativeNetRequest } from './declarativeNetRequest'
import { registerDownloads } from './downloads'
import { registerExtension } from './extension'
import { registerHistory } from './history'
import { registerIdle } from './idle'
import { registerManagement } from './management'
import { registerMv2Stubs } from './mv2Stubs'
import { registerNotifications } from './notifications'
import { registerProxy } from './proxy'
import { registerRuntime } from './runtime'
import { registerSearch } from './search'
import { registerSessions } from './sessions'
import { registerStorageApi } from './storageApi'
import { registerSystemCpu } from './systemCpu'
import { registerSystemDisplay } from './systemDisplay'
import { registerSystemMemory } from './systemMemory'
import { registerTabGroups } from './tabGroups'
import { registerTopSites } from './topSites'
import { registerTts } from './tts'
import { registerWebRequest } from './webRequest'
import { registerWindows } from './windows'
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
  registerDeclarativeNetRequest()
  registerI18n()
  registerCommands()
  registerContentSettings()
  registerContextMenus()
  registerStorageApi()
  registerDownloads()
  registerExtension()
  registerHistory()
  registerIdle()
  registerManagement()
  registerMv2Stubs()
  registerNotifications()
  registerProxy()
  registerRuntime()
  registerSearch()
  registerSessions()
  registerTts()
  registerSystemCpu()
  registerSystemDisplay()
  registerSystemMemory()
  registerTabGroups()
  registerTopSites()
  registerWebRequest()
  registerWindows()
}

export { refreshCommandShortcuts } from './commands'

export { invokeExtensionApi } from './registry'
