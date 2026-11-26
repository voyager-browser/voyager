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
  { path: 'debugger', permissions: ['debugger'] },
  { path: 'declarativeContent', permissions: ['declarativeContent'] },
  { path: 'declarativeWebRequest', permissions: ['declarativeWebRequest'] },
  { path: 'desktopCapture', permissions: ['desktopCapture'] },
  { path: 'dom' },
  { path: 'pageCapture', permissions: ['pageCapture'] },
  { path: 'tabCapture', permissions: ['tabCapture'] },
  { path: 'devtools.inspectedWindow' },
  { path: 'devtools.network' },
  { path: 'devtools.panels' },
  { path: 'devtools.performance' },
  { path: 'devtools.recorder' },
  { path: 'fontSettings', permissions: ['fontSettings'] },
  { path: 'gcm', permissions: ['gcm'] },
  { path: 'identity', permissions: ['identity'] },
  { path: 'instanceID', permissions: ['gcm'] },
  { path: 'mimeHandler' },
  { path: 'omnibox' },
  { path: 'power', permissions: ['power'] },
  { path: 'printerProvider', permissions: ['printerProvider'] },
  { path: 'publicSuffix', permissions: ['publicSuffix'] },
  { path: 'system.storage', permissions: ['system.storage'] }
]

export function registerMv2Stubs(): void {
  for (const stub of STUBS) {
    registerExtensionApiHandler(stub.path, {
      ...(stub.permissions ? { permissions: stub.permissions } : {}),
      invoke: () => undefined
    })
  }
}
