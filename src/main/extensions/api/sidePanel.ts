import { registerExtensionApiHandler } from './registry'

const PATH = 'sidePanel'

/**
 * Voyager hosts extension popups in its own toolbar panel and has no Chrome
 * side panel. Keep the API callable so extensions that configure a side panel
 * during startup do not abort their background initialization.
 */
export function registerSidePanel(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(_context, method): unknown {
      switch (method) {
        case 'open':
        case 'setOptions':
        case 'setPanelBehavior':
          return undefined
        case 'getOptions':
          return {}
        case 'getPanelBehavior':
          return { openPanelOnActionClick: false }
        default:
          throw new Error(`chrome.${PATH}.${method} is not supported.`)
      }
    }
  })
}
