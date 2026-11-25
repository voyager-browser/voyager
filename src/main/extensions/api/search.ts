import { webContents as electronWebContents } from 'electron'
import { DEFAULT_SEARCH_ENGINE, buildSearchUrl, isSearchEngineId } from '../../../shared/search'
import { sessionForProfile } from '../../profiles/session'
import { createWindow } from '../../window/createWindow'
import type { WindowController } from '../../window/WindowController'
import { activeWindow, allWindows } from '../../window/windowRegistry'
import { registerExtensionApiHandler } from './registry'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** Prefer the focused window of this profile, then a window using its session. */
function targetWindow(profileId: string): WindowController | null {
  const windows = allWindows().filter((window) => window.profile === profileId)
  const focused = activeWindow()
  if (focused && focused.profile === profileId) return focused

  const ses = sessionForProfile(profileId)
  const inSession = windows.find((window) => {
    const id = window.tabs.activeWebContentsId()
    const contents = id === null ? null : electronWebContents.fromId(id)
    return contents?.session === ses
  })
  return inSession ?? windows.find((window) => window.window.isFocused()) ?? windows[0] ?? null
}

export function registerSearch(): void {
  registerExtensionApiHandler('search', {
    permissions: ['search'],
    invoke(context, method, args): unknown {
      if (method !== 'query') throw new Error(`chrome.search.${method} is not supported.`)
      const options = record(args[0])
      if (typeof options.text !== 'string') throw new Error('chrome.search.query requires text')

      const disposition =
        options.disposition === 'CURRENT_TAB' ||
        options.disposition === 'NEW_WINDOW' ||
        options.disposition === 'NEW_TAB'
          ? options.disposition
          : 'NEW_TAB'

      const window = targetWindow(context.profileId)
      const preferred = options.searchEngine ?? window?.searchEngine ?? DEFAULT_SEARCH_ENGINE
      const url = buildSearchUrl(
        isSearchEngineId(preferred) ? preferred : DEFAULT_SEARCH_ENGINE,
        options.text
      )

      if (disposition === 'NEW_WINDOW' || !window) {
        createWindow({
          url,
          profileId: context.profileId,
          incognito: window?.isIncognito === true
        })
        return undefined
      }

      if (disposition === 'CURRENT_TAB') {
        window.window.focus()
        window.tabs.navigate(url)
      } else {
        window.openUrl(url)
      }
      return undefined
    }
  })
}
