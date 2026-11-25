import { app, webContents, type Session } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  ExtensionWebNavigationDetails,
  ExtensionWebNavigationEventName
} from '../../shared/extensionNavigation'
import { hasAllExtensionPermissions } from './extensionPermissions'
import { extensionCanAccessSite } from './siteAccess'

const instrumented = new WeakSet<Electron.WebContents>()

function isExtensionUrl(url: string): boolean {
  return url.startsWith('chrome-extension://')
}

function extensionIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'chrome-extension:' ? parsed.host : null
  } catch {
    return null
  }
}

function isPageUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
}

/** Only extensions with the permission and current site access see page URLs. */
function canReceiveNavigation(
  ses: Session,
  profileId: string,
  extensionId: string | null,
  pageUrl: string
): boolean {
  if (!extensionId) return false
  const extension = ses.extensions
    .getAllExtensions()
    .find((candidate) => candidate.id === extensionId)
  if (!extension) return false
  const manifest = (extension.manifest ?? {}) as Record<string, unknown>
  const required = Array.isArray(manifest.permissions)
    ? manifest.permissions.includes('webNavigation')
    : false
  const optional = Array.isArray(manifest.optional_permissions)
    ? manifest.optional_permissions.includes('webNavigation')
    : false
  if (!required && !optional) return false
  if (!required && !hasAllExtensionPermissions(profileId, extensionId, ['webNavigation'])) {
    return false
  }
  return extensionCanAccessSite(profileId, extensionId, pageUrl)
}

/** Deliver navigation events to eligible extension pages and workers. */
function broadcast(ses: Session, profileId: string, details: ExtensionWebNavigationDetails): void {
  for (const target of webContents.getAllWebContents()) {
    if (target.isDestroyed() || target.session !== ses) continue
    const url = target.getURL()
    if (!isExtensionUrl(url)) continue
    if (!canReceiveNavigation(ses, profileId, extensionIdFromUrl(url), details.url)) continue
    target.send(IpcChannels.ExtensionWebNavigationEvent, details)
  }

  const running = ses.serviceWorkers.getAllRunning()
  for (const versionId of Object.keys(running)) {
    const scope = running[Number(versionId)].scope
    if (!isExtensionUrl(scope)) continue
    const worker = ses.serviceWorkers.getWorkerFromVersionID(Number(versionId))
    if (!worker || worker.isDestroyed()) continue
    if (!canReceiveNavigation(ses, profileId, extensionIdFromUrl(scope), details.url)) continue
    worker.send(IpcChannels.ExtensionWebNavigationEvent, details)
  }
}

/**
 * Electron does not implement `chrome.webNavigation`, so extensions that register
 * navigation listeners crash when their background script starts. Mirror Voyager's
 * tab navigations into the extension contexts instead.
 */
export function attachExtensionWebNavigation(ses: Session, profileId: string): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== ses || instrumented.has(contents)) return
    instrumented.add(contents)

    const emit = (event: ExtensionWebNavigationEventName, url: string): void => {
      if (!isPageUrl(url)) return
      broadcast(ses, profileId, {
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
