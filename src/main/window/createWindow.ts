import { queuePendingUrls, takePendingUrls } from '../launch/pendingUrls'
import { lastProfileId, setLastProfileId } from '../profiles/profiles'
import { WindowController } from './WindowController'
import { registerWindow } from './windowRegistry'

export interface CreateWindowOptions {
  url?: string
  incognito?: boolean
  /** Profile to open. Defaults to the profile used most recently. */
  profileId?: string
}

/** Open another full Voyager window, replaying any queued external URLs. */
export function createWindow(options: CreateWindowOptions | string = {}): WindowController {
  const normalized = typeof options === 'string' ? { url: options } : options
  const profileId = normalized.profileId ?? lastProfileId()
  // An explicitly requested URL keeps its place; queued links follow it in
  // arrival order. Deduplicate so a repeated launch event opens one tab.
  const urls = [
    ...new Set([normalized.url, ...takePendingUrls()].filter((url): url is string => Boolean(url)))
  ]
  const [initialUrl, ...queuedUrls] = urls
  const controller = new WindowController({ incognito: normalized.incognito, profileId })
  if (!normalized.incognito) setLastProfileId(profileId)
  registerWindow(controller)
  void controller.show(initialUrl).then(
    () => {
      // show() already opened initialUrl as a tab; only dedupe against it so the
      // remaining queued links are still opened below.
      const seen = new Set(initialUrl ? [initialUrl] : [])
      // Include links that arrived while this window was starting.
      for (const url of [...queuedUrls, ...takePendingUrls()]) {
        if (seen.has(url)) continue
        seen.add(url)
        controller.openUrl(url)
      }
    },
    () => queuePendingUrls(urls)
  )
  return controller
}

export function createIncognitoWindow(url?: string, profileId?: string): WindowController {
  return createWindow({ url, incognito: true, profileId })
}
