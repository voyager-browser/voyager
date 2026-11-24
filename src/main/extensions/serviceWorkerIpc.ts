import type {
  IpcMainInvokeEvent,
  IpcMainServiceWorkerInvokeEvent,
  ServiceWorkerMain,
  Session
} from 'electron'

/** Handler shared by frame IPC (ipcMain) and extension service-worker IPC. */
export type ExtensionInvokeHandler = (
  event: IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent,
  ...args: any[]
) => unknown

/** Lifecycle surface shared by permission prompts and native messaging ports. */
export interface WorkerSender {
  isDestroyed(): boolean
  onDestroyed(listener: () => void): void
  removeDestroyedListener(listener: () => void): void
}

/** Adapt a service worker's stopped status to a sender lifecycle. */
export function serviceWorkerSender(
  serviceWorker: ServiceWorkerMain,
  session: Session
): WorkerSender {
  const listeners = new Map<
    () => void,
    (details: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => void
  >()
  return {
    isDestroyed: () => serviceWorker.isDestroyed(),
    onDestroyed: (listener) => {
      const handler = (
        details: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>
      ) => {
        if (details.versionId === serviceWorker.versionId && details.runningStatus === 'stopped') {
          listener()
        }
      }
      listeners.set(listener, handler)
      session.serviceWorkers.on('running-status-changed', handler)
    },
    removeDestroyedListener: (listener) => {
      const handler = listeners.get(listener)
      if (handler) session.serviceWorkers.off('running-status-changed', handler)
      listeners.delete(listener)
    }
  }
}

const handlers = new Map<string, ExtensionInvokeHandler>()
const attachedSessions = new WeakMap<Session, WeakSet<ServiceWorkerMain>>()

/** Save the compatibility handlers once the main IPC registry is built. */
export function registerExtensionInvokeHandlers(
  entries: Map<string, ExtensionInvokeHandler>
): void {
  handlers.clear()
  for (const [channel, handler] of entries) handlers.set(channel, handler)
}

/**
 * Electron dispatches service-worker `ipcRenderer.invoke()` calls only to
 * `ServiceWorkerMain.ipc`, not `ipcMain`. Forward the same compatibility
 * handlers to every extension worker so the bridges work from background
 * scripts without producing "No handler registered" errors in the main log.
 */
export function attachExtensionServiceWorkerIpc(ses: Session): void {
  let registered = attachedSessions.get(ses)
  if (!registered) {
    registered = new WeakSet<Electron.ServiceWorkerMain>()
    attachedSessions.set(ses, registered)
  }

  const register = (worker: ServiceWorkerMain | undefined): void => {
    if (!worker || worker.isDestroyed() || registered.has(worker)) return
    registered.add(worker)
    for (const [channel, handler] of handlers) {
      try {
        worker.ipc.handle(channel, (event, ...args) => handler(event, ...args))
      } catch {
        // The worker may have stopped between the status event and registration.
      }
    }
  }

  ses.serviceWorkers.on('running-status-changed', (details) => {
    if (details.runningStatus !== 'starting' && details.runningStatus !== 'running') return
    register(ses.serviceWorkers.getWorkerFromVersionID(details.versionId))
  })

  try {
    const running = ses.serviceWorkers.getAllRunning()
    for (const versionId of Object.keys(running)) {
      register(ses.serviceWorkers.getWorkerFromVersionID(Number(versionId)))
    }
  } catch {
    // Service worker inspection can fail while a session is still initializing.
  }
}
