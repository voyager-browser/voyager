import { randomUUID } from 'node:crypto'
import { allWindows } from '../../window/windowRegistry'
import { registerExtensionApiHandler } from './registry'
import type { ExtensionApiContext } from './types'

const PATH = 'runtime'

interface RuntimeContext {
  contextId: string
  contextType: 'POPUP'
  tabId: number
  windowId: number
  frameId: number
  incognito: boolean
  documentUrl: string
  documentOrigin: string
}

/**
 * Electron's native `runtime.getContexts()` cannot classify Voyager's in-window
 * extension panels and logs a Chromium NOTREACHED for their view type. Report
 * the open panels ourselves so extensions can still detect their own popups.
 */
function contextsFor(context: ExtensionApiContext): RuntimeContext[] {
  const origin = context.extension.url.replace(/\/$/, '')
  const result: RuntimeContext[] = []
  for (const window of allWindows()) {
    if (window.profile !== context.profileId || window.window.isDestroyed()) continue
    const webContents = window.extensionPanelWebContents()
    if (!webContents || webContents.isDestroyed()) continue
    const url = webContents.getURL()
    if (!url.startsWith(`${origin}/`)) continue
    result.push({
      contextId: randomUUID(),
      contextType: 'POPUP',
      tabId: -1,
      windowId: window.window.id,
      frameId: -1,
      incognito: window.isIncognito,
      documentUrl: url,
      documentOrigin: new URL(url).origin
    })
  }
  return result
}

export function registerRuntime(): void {
  registerExtensionApiHandler(PATH, {
    invoke(context, method): unknown {
      if (method === 'getContexts') return contextsFor(context)
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
