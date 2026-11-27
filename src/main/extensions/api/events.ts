import { app, session, webContents, type ServiceWorkerMain, type WebContents } from 'electron'
import type { ExtensionApiEventPayload } from '../../../shared/extensionApi'
import { IpcChannels } from '../../../shared/ipc-channels'
import { profilePartition } from '../../profiles/profiles'
import { hasApiPermission } from './permissions'

type ExtensionTarget = WebContents | ServiceWorkerMain

let shuttingDown = false
const wakingScopes = new Set<string>()
app.once('before-quit', () => {
  shuttingDown = true
})

export function isExtensionApiShuttingDown(): boolean {
  return shuttingDown
}

/** Make sure a Chromium request callback is settled exactly once. */
export function onceCallback<T>(callback: (value: T) => void): (value: T) => void {
  let settled = false
  return (value) => {
    if (settled) return
    settled = true
    callback(value)
  }
}

function extensionIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'chrome-extension:' ? url.host : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Chrome derives a service worker's scope from the directory of its script. */
function serviceWorkerScope(extensionId: string, manifest: Record<string, unknown>): string | null {
  const script = record(manifest.background).service_worker
  if (typeof script !== 'string' || !script) return null
  try {
    return new URL('.', new URL(script, `chrome-extension://${extensionId}/`)).href
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
    const extensions = ses.extensions.getAllExtensions()
    if (extensions.length === 0) return
    const allowedId = (id: string | null): boolean => {
      if (!id) return false
      if (payload.extensionId && id !== payload.extensionId) return false
      const extension = extensions.find((item) => item.id === id)
      if (!extension) return false
      return hasApiPermission(profileId, id, record(extension.manifest), permission)
    }
    const allowed = (target: ExtensionTarget): boolean =>
      allowedId(
        extensionIdFromUrl(
          'getURL' in target ? target.getURL() : (target as ServiceWorkerMain).scope
        )
      )
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
    const runningScopes = new Set(Object.values(running).map((info) => info.scope))
    for (const versionId of Object.keys(running)) {
      const worker = ses.serviceWorkers.getWorkerFromVersionID(Number(versionId))
      if (worker) send(worker)
    }

    // Chrome wakes a background service worker for extension events. Electron
    // only exposes already-running workers, so emulated events would otherwise
    // be lost while a worker is suspended (for example storage.onChanged during
    // Bitwarden's login flow).
    for (const extension of extensions) {
      if (!allowedId(extension.id)) continue
      const scope = serviceWorkerScope(extension.id, record(extension.manifest))
      if (!scope || runningScopes.has(scope) || wakingScopes.has(scope)) continue
      wakingScopes.add(scope)
      void ses.serviceWorkers
        .startWorkerForScope(scope)
        .then((worker) => send(worker))
        .catch(() => undefined)
        .finally(() => wakingScopes.delete(scope))
    }
  } catch {
    // Event fan-out must never throw into an Electron lifecycle handler.
  }
}
