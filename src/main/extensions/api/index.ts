import { registerAccessibilityFeatures } from './accessibilityFeatures'
import { registerAlarms, restoreAlarms } from './alarms'
import { registerBookmarks } from './bookmarks'
import { registerBrowsingData } from './browsingData'
import { registerCookies } from './cookies'

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
}

export { invokeExtensionApi } from './registry'
