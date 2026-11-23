import { app, webContents, type Session } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  ExtensionWebNavigationDetails,
  ExtensionWebNavigationEventName
} from '../../shared/extensionNavigation'

const instrumented = new WeakSet<Electron.WebContents>()

function isExtensionUrl(url: string): boolean {
  return url.startsWith('chrome-extension://')
}

function isPageUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
}

/** Deliver navigation events to extension pages and running service workers. */
function broadcast(ses: Session, details: ExtensionWebNavigationDetails): void {
  for (const target of webContents.getAllWebContents()) {
    if (target.isDestroyed() || target.session !== ses) continue
    if (!isExtensionUrl(target.getURL())) continue
    target.send(IpcChannels.ExtensionWebNavigationEvent, details)
  }

  const running = ses.serviceWorkers.getAllRunning()
  for (const versionId of Object.keys(running)) {
    if (!isExtensionUrl(running[Number(versionId)].scope)) continue
    const worker = ses.serviceWorkers.getWorkerFromVersionID(Number(versionId))
    if (!worker || worker.isDestroyed()) continue
    worker.send(IpcChannels.ExtensionWebNavigationEvent, details)
  }
}

/**
 * Electron does not implement `chrome.webNavigation`, so extensions that register
 * navigation listeners crash when their background script starts. Mirror Voyager's
 * tab navigations into the extension contexts instead.
 */
export function attachExtensionWebNavigation(ses: Session): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== ses || instrumented.has(contents)) return
    instrumented.add(contents)

    const emit = (event: ExtensionWebNavigationEventName, url: string): void => {
      if (!isPageUrl(url)) return
      broadcast(ses, {
        event,
        tabId: contents.id,
        frameId: 0,
        url,
        timeStamp: Date.now(),
        transitionType: 'other'
      })
    }

    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame) emit('onBeforeNavigate', details.url)
    })
    contents.on('did-navigate', (_navigateEvent, url) => emit('onCommitted', url))
    contents.on('dom-ready', () => emit('onDOMContentLoaded', contents.getURL()))
    contents.on('did-navigate-in-page', (_navigateEvent, url) => {
      emit('onHistoryStateUpdated', url)
    })
    contents.on('did-finish-load', () => emit('onCompleted', contents.getURL()))
  })
}
