import { registerExtensionApiHandler } from './registry'

interface Mv2Stub {
  path: string
  permissions?: string[]
}

/**
 * MV2-only APIs that Voyager cannot implement natively are still exposed as
 * callable, permission-aware no-ops. Renderer fallbacks supply the documented
 * return shapes, so extensions can bootstrap without runtime errors.
 */
const STUBS: Mv2Stub[] = [
  { path: 'browserAction' },
  { path: 'pageAction' },
  { path: 'debugger', permissions: ['debugger'] }
]

export function registerMv2Stubs(): void {
  for (const stub of STUBS) {
    registerExtensionApiHandler(stub.path, {
      ...(stub.permissions ? { permissions: stub.permissions } : {}),
      invoke: () => undefined
    })
  }
}
