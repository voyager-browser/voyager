import { lastProfileId, setLastProfileId } from '../profiles/profiles'
import { WindowController } from './WindowController'
import { registerWindow } from './windowRegistry'

export interface CreateWindowOptions {
  url?: string
  incognito?: boolean
  /** Profile to open. Defaults to the profile used most recently. */
  profileId?: string
}

/** Open another full Voyager window. */
export function createWindow(options: CreateWindowOptions | string = {}): WindowController {
  const normalized = typeof options === 'string' ? { url: options } : options
  const profileId = normalized.profileId ?? lastProfileId()
  const controller = new WindowController({ incognito: normalized.incognito, profileId })
  if (!normalized.incognito) setLastProfileId(profileId)
  registerWindow(controller)
  void controller.show(normalized.url)
  return controller
}

export function createIncognitoWindow(url?: string, profileId?: string): WindowController {
  return createWindow({ url, incognito: true, profileId })
}
