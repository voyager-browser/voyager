/** Persisted user preferences; new settings extend this shape over time. */
import type { NativeMessagingHost } from '../../shared/types'
import type { SearchEngineId } from '../../shared/search'
import type { BrowserTheme, StartPageBackground } from '../../shared/types'

export interface SettingsShape {
  themeMode?: 'system' | 'light' | 'dark'
  browserTheme?: BrowserTheme
  startPageBackground?: StartPageBackground
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
  customFilterListErrors?: Record<string, string>
  customFilterFiles?: { id: string; name: string; addedAt: number }[]
  contentBlockingExceptions?: string[]
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
  installedExtensions?: string[]
  extensionUpdateInfo?: Record<
    string,
    {
      storeId?: string
      updateUrl?: string
      version?: string
      lastCheckedAt?: number
    }
  >
  extensionPermissionDecisions?: Record<string, Record<string, 'allow' | 'block'>>
  passwordSavingEnabled?: boolean
  nativeMessagingHosts?: NativeMessagingHost[]
}
