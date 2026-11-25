import { app, session, webContents, type ServiceWorkerMain, type WebContents } from 'electron'
import type { ExtensionApiEventPayload } from '../../../shared/extensionApi'
import { IpcChannels } from '../../../shared/ipc-channels'
import { profilePartition } from '../../profiles/profiles'
import { hasApiPermission } from './permissions'

type ExtensionTarget = WebContents | ServiceWorkerMain

let shuttingDown = false
app.once('before-quit', () => {
  shuttingDown = true
})

function extensionIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'chrome-extension:' ? url.host : null
  } catch {
    return null
  }
}

/**
 * Send an emulated API event to extension pages and workers in one profile.
 * Only extensions that declare or were granted the event's permission receive it.
 */
export function broadcastExtensionApiEvent(
  profileId: string,
  payload: ExtensionApiEventPayload,
  permission?: string
): void {
  // API namespaces register before app.whenReady(). Electron's session and
  // service-worker APIs are unavailable until then, no extension context can
  // receive an event before the first window is ready, and quit-time handlers
  // must not touch objects Chromium is already tearing down.
  if (shuttingDown || !app.isReady()) return
  try {
    const partition = profilePartition(profileId)
    const ses = partition ? session.fromPartition(partition) : session.defaultSession
    // Most sessions have no extensions at all. Skip the webContents and
    // service-worker enumeration entirely when nobody can receive the event;
    // this also keeps shutdown from touching Electron objects being torn down.
    if (ses.extensions.getAllExtensions().length === 0) return
    const allowed = (target: ExtensionTarget): boolean => {
      const id = extensionIdFromUrl(
        'getURL' in target ? target.getURL() : (target as ServiceWorkerMain).scope
      )
      if (!id) return false
      if (payload.extensionId && id !== payload.extensionId) return false
      const extension = ses.extensions.getAllExtensions().find((item) => item.id === id)
      if (!extension) return false
      const manifest = (extension.manifest ?? {}) as Record<string, unknown>
      return hasApiPermission(profileId, id, manifest, permission)
    }
    const send = (target: ExtensionTarget): void => {
      if (target.isDestroyed() || !allowed(target)) return
      try {
        target.send(IpcChannels.ExtensionApiEvent, payload)
      } catch {
        // The extension context can disappear between inspection and delivery.
      }
    }

    for (const target of webContents.getAllWebContents()) {
      if (target.session === ses) send(target)
    }

    const running = ses.serviceWorkers.getAllRunning()
    for (const versionId of Object.keys(running)) {
      const worker = ses.serviceWorkers.getWorkerFromVersionID(Number(versionId))
      if (worker) send(worker)
    }
  } catch {
    // Event fan-out must never throw into an Electron lifecycle handler.
  }
}
