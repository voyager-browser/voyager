/** Persisted user preferences; new settings extend this shape over time. */
import type { SearchEngineId } from '../../shared/search'

export interface SettingsShape {
  themeMode?: 'system' | 'light' | 'dark'
  bookmarksBarVisible?: boolean
  clearHistory?: boolean
  clearDownloads?: boolean
  clearBookmarks?: boolean
  clearCookies?: boolean
  clearLocalStorage?: boolean
  clearIndexedDb?: boolean
  clearCache?: boolean
  clearSitePermissions?: boolean
  openDownloadsWhenDone?: boolean
  searchEngine?: SearchEngineId
  restoreSession?: boolean
  verticalTabs?: boolean
  contentBlocking?: boolean
}
