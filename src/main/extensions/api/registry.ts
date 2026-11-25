import { requireApiPermission } from './permissions'
import type { ExtensionApiCall, ExtensionApiContext, ExtensionApiHandlerSpec } from './types'

const handlers = new Map<string, ExtensionApiHandlerSpec>()

/** Register one dotted API path, such as `accessibilityFeatures.animationPolicy`. */
export function registerExtensionApiHandler(path: string, spec: ExtensionApiHandlerSpec): void {
  handlers.set(path, spec)
}

function permissionsFor(spec: ExtensionApiHandlerSpec, method: string): string[] {
  if (!spec.permissions) return []
  if (Array.isArray(spec.permissions)) return spec.permissions
  return spec.permissions[method] ?? spec.permissions['*'] ?? []
}

export async function invokeExtensionApi(
  context: ExtensionApiContext,
  call: ExtensionApiCall
): Promise<unknown> {
  const path = Array.isArray(call?.path) ? call.path.join('.') : ''
  const spec = handlers.get(path)
  if (!spec) throw new Error(`chrome.${path || '<unknown>'} is not supported in this build.`)
  requireApiPermission(
    context.profileId,
    context.extensionId,
    context.manifest,
    permissionsFor(spec, call.method)
  )
  return spec.invoke(context, call.method, Array.isArray(call.args) ? call.args : [])
}
