import { registerAccessibilityFeatures } from './accessibilityFeatures'
import { registerAlarms, restoreAlarms } from './alarms'

let registered = false

/** Register every emulated extension API namespace exactly once. */
export function registerExtensionApis(): void {
  if (registered) return
  registered = true
  registerAccessibilityFeatures()
  registerAlarms()
  restoreAlarms()
}

export { invokeExtensionApi } from './registry'
