import { WindowController } from './WindowController'
import { registerWindow } from './windowRegistry'

export interface CreateWindowOptions {
  url?: string
  incognito?: boolean
}

/** Open another full Voyager window. */
export function createWindow(options: CreateWindowOptions | string = {}): WindowController {
  const normalized = typeof options === 'string' ? { url: options } : options
  const controller = new WindowController({ incognito: normalized.incognito })
  registerWindow(controller)
  void controller.show(normalized.url)
  return controller
}

export function createIncognitoWindow(url?: string): WindowController {
  return createWindow({ url, incognito: true })
}
