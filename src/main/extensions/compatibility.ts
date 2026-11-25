import { join } from 'node:path'
import type { Session } from 'electron'
import { refreshCommandShortcuts } from './api'
import { attachContextMenus } from './api/contextMenus'
import { attachCookieEvents } from './api/cookies'
import { attachDownloadEvents } from './api/downloads'
import { attachExtensions } from './extensions'
import { attachExtensionServiceWorkerIpc } from './serviceWorkerIpc'
import { attachExtensionWebNavigation } from './webNavigation'

/**
 * Register the extension compatibility preload and navigation bridge once per
 * profile session. The preload is intentionally unfiltered; it exits early in
 * non-extension contexts because `chrome-extension://` is not a valid content
 * script match pattern.
 */
export function attachExtensionCompatibility(ses: Session, profileId: string): void {
  const filePath = join(__dirname, '../preload/extensionCompat.js')
  ses.registerPreloadScript({
    id: `voyager-extension-compat-frame-${profileId}`,
    type: 'frame',
    filePath
  })
  ses.registerPreloadScript({
    id: `voyager-extension-compat-worker-${profileId}`,
    type: 'service-worker',
    filePath
  })
  attachExtensionServiceWorkerIpc(ses)
  attachExtensionWebNavigation(ses, profileId)
  attachCookieEvents(ses, profileId)
  attachContextMenus(ses, profileId)
  attachDownloadEvents(ses, profileId)
  void attachExtensions(ses, profileId).then(() => refreshCommandShortcuts(ses, profileId))
}
