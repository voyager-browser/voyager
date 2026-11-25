import { registerAccessibilityFeatures } from './accessibilityFeatures'

let registered = false

/** Register every emulated extension API namespace exactly once. */
export function registerExtensionApis(): void {
  if (registered) return
  registered = true
  registerAccessibilityFeatures()
}

export { invokeExtensionApi } from './registry'
