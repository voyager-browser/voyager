import { join } from 'node:path'
import type { Session } from 'electron'
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
  attachExtensionWebNavigation(ses)
}
