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
  builtinFilterList?: boolean
  filterLists?: string[]
  customFilterLists?: string[]
  customFilterFiles?: { id: string; name: string; addedAt: number }[]
  proxyMode?: 'system' | 'direct' | 'fixed_servers'
  proxyScheme?: 'http' | 'https' | 'socks4' | 'socks5'
  proxyHost?: string
  proxyPort?: number
  proxyBypassRules?: string
  spellcheck?: boolean
  showHomeButton?: boolean
  homeUrl?: string
  memorySaver?: boolean
  developerMode?: boolean
  userAgent?: string
  preloadTopSites?: boolean
  autofillProfiles?: boolean
  autofillPayments?: boolean
  saveFormHistory?: boolean
}
