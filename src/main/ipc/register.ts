import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type Extension,
  type WebContents
} from 'electron'
import { resolve } from 'node:path'
import { IpcChannels } from '../../shared/ipc-channels'
import {
  isExtensionPermissionChoice,
  isPermissionKind,
  isPermissionRequestChoice
} from '../../shared/permissions'
import {
  DEFAULT_PROFILE_ID,
  type CreateProfileInput,
  type ProfilesState,
  type RenameProfileInput
} from '../../shared/profiles'
import type {
  AppVersionInfo,
  BookmarkFolderPatch,
  BookmarkMoveInput,
  BookmarkNodeKind,
  BookmarkPatch,
  BookmarksState,
  CertificateExportFormat,
  ClearBrowsingDataOptions,
  ExtensionInfo,
  NewBookmarkFolderInput,
  NewBookmarkInput,
  NewTabRequest,
  PermissionKind,
  PermissionRequestChoice,
  SettingsTarget,
  SitePermissionsState,
  ThemeMode,
  ThemeState,
  UserPreferences,
  WindowState
} from '../../shared/types'
import { DEFAULT_SEARCH_ENGINE, isSearchEngineId, type SearchEngineId } from '../../shared/search'
import {
  addBookmark,
  addFolder,
  clearBookmarks,
  copyBookmarkNode,
  currentBookmarkClipboard,
  currentBookmarksState,
  cutBookmarkNode,
  moveBookmarkNode,
  pasteBookmarkNode,
  removeBookmark,
  removeFolder,
  toggleBookmarksBar,
  updateBookmark,
  updateFolder
} from '../bookmarks/bookmarks'
import {
  clearHistory,
  currentHistoryState,
  publishHistory,
  recordVisit,
  removeHistory
} from '../history/history'
import {
  clearSitePermissions,
  configurePermissionPromptRouter,
  currentSitePermissions,
  removeSitePermissions,
  respondToPermissionRequest,
  sitePermissionsForOrigin,
  undoPermissionAutoRemoval
} from '../permissions/permissions'
import { exportCertificate, getCertificate } from '../certificates/certificates'
import type { WindowController } from '../window/WindowController'
import {
  openSettingsWindow,
  sendToSettingsWindow,
  settingsProfileFor,
  settingsTargetProfileId
} from '../window/settingsWindow'
import {
  activeWindow,
  allWindows,
  setBookmarksBarVisibleForProfile,
  windowForAnyWebContents,
  windowForWebContents
} from '../window/windowRegistry'
import { consumePendingDragUrl, setPendingDragUrl } from '../bookmarks/drag'
import { isFilterListId } from '../../shared/filter-lists'
import {
  builtinFilterListEnabled,
  contentBlockingExceptions,
  contentBlockingStats,
  customFilterListErrors,
  enabledCustomFilterFiles,
  enabledCustomFilterLists,
  enabledFilterLists,
  importCustomFilterFile,
  normalizeCustomFilterUrl,
  primeContentBlocking,
  removeCustomFilterFile,
  setContentBlockingExceptions,
  setContentBlockingSiteEnabled,
  setFilterListStatusListener,
  syncContentBlocking
} from '../contentBlocking/contentBlocking'
import {
  createProfile,
  deleteProfile,
  listProfiles,
  setLastProfileId,
  updateProfile
} from '../profiles/profiles'
import {
  broadcastProfiles,
  broadcastToAll,
  broadcastToProfile,
  ensureProfileSession,
  sessionForProfile
} from '../profiles/session'
import {
  applyProxyForProfile,
  isProxyMode,
  isProxyScheme,
  normalizeProxyBypassRules,
  normalizeProxyHost,
  normalizeProxyPort
} from '../proxy/proxy'
import { applyUserAgentForProfile, userAgentForProfile } from '../userAgent/userAgent'
import { refreshAppMenu } from '../menu/menu'
import { runTopSitesPreload } from '../preload/preloadTopSites'
import { DEFAULT_PROXY_CONFIG } from '../../shared/proxy'
import { DEFAULT_NEW_TAB_URL } from '../../shared/constants'
import { createWindow } from '../window/createWindow'
import { getSettings, getThemeMode, setSettings, setThemeMode, storesFor } from '../store'
import {
  clearFormHistory,
  currentAutofillState,
  deleteAddress,
  deleteContact,
  deletePaymentMethod,
  getAutofillProfileSuggestions,
  getFormHistorySuggestions,
  recordFormHistory,
  removeFormHistoryEntry,
  saveAddress,
  saveContact,
  savePaymentMethod
} from '../autofill/autofill'
import {
  currentExtensionsState,
  extensionResourceUrl,
  hostAccessForManifest,
  installExtension,
  installExtensionFromStore,
  setExtensionPinned,
  setExtensionSiteAccess,
  uninstallExtension
} from '../extensions/extensions'
import {
  extensionOriginKey,
  extensionPermissionGrants,
  hasAllExtensionPermissions,
  recordExtensionPermissionDecision,
  removeExtensionPermissions,
  requestExtensionPermissions,
  respondToExtensionPermission
} from '../extensions/extensionPermissions'
import {
  connectNative,
  disconnectNative,
  getNativeHosts,
  postToNative,
  sendNativeMessage,
  setNativeHosts
} from '../extensions/nativeMessaging'

import { isDefaultBrowser, setDefaultBrowser } from '../defaultBrowser'
import {
  cancelDownload,
  clearDownloads,
  currentDownloadsState,
  downloadUrl,
  openDownloadFolder,
  pauseDownload,
  publishDownloads,
  removeDownload,
  resumeDownload
} from '../downloads/downloads'
import { requestPrompt, respondToPrompt } from '../prompt/prompt'

type SenderEvent =
  { sender?: Electron.WebContents } | Electron.IpcMainInvokeEvent | Electron.IpcMainEvent

/** Outbound channel + access to the live window so handlers can act on it. */
export interface IpcContext {
  send(channel: string, payload?: unknown): void
  getWindow(event?: SenderEvent): WindowController | null
  openWindow?(url?: string, profileId?: string): void
  openIncognitoWindow?(url?: string, profileId?: string): void
}

function currentThemeState(): ThemeState {
  const mode = getThemeMode()
  nativeTheme.themeSource = mode
  return { mode, dark: nativeTheme.shouldUseDarkColors }
}

function applyThemeMode(mode: ThemeMode): ThemeState {
  setThemeMode(mode)
  if (nativeTheme.themeSource !== mode) {
    nativeTheme.themeSource = mode
    // Sites often cache theme-dependent assets such as favicons and media
    // queries, so an explicit mode change refreshes every open page.
    for (const window of allWindows()) window.tabs.reloadAll()
  }
  return { mode, dark: nativeTheme.shouldUseDarkColors }
}

function userPreferences(profileId: string): UserPreferences {
  return {
    clearHistory: (getSettings(profileId, 'clearHistory', true) as boolean) !== false,
    clearDownloads: (getSettings(profileId, 'clearDownloads', true) as boolean) !== false,
    clearBookmarks: getSettings(profileId, 'clearBookmarks', false) === true,
    clearCookies: (getSettings(profileId, 'clearCookies', true) as boolean) !== false,
    clearLocalStorage: (getSettings(profileId, 'clearLocalStorage', true) as boolean) !== false,
    clearIndexedDb: (getSettings(profileId, 'clearIndexedDb', true) as boolean) !== false,
    clearCache: (getSettings(profileId, 'clearCache', true) as boolean) !== false,
    clearSitePermissions:
      (getSettings(profileId, 'clearSitePermissions', true) as boolean) !== false,
    openDownloadsWhenDone: getSettings(profileId, 'openDownloadsWhenDone', false) === true,
    searchEngine: (() => {
      const stored = getSettings<SearchEngineId>(profileId, 'searchEngine', DEFAULT_SEARCH_ENGINE)
      return isSearchEngineId(stored) ? stored : DEFAULT_SEARCH_ENGINE
    })(),
    restoreSession: getSettings(profileId, 'restoreSession', false) === true,
    verticalTabs: getSettings(profileId, 'verticalTabs', false) === true,
    contentBlocking: (getSettings(profileId, 'contentBlocking', false) as boolean) === true,
    builtinFilterList: builtinFilterListEnabled(profileId),
    filterLists: enabledFilterLists(profileId),
    customFilterLists: enabledCustomFilterLists(profileId),
    customFilterListErrors: customFilterListErrors(profileId),
    customFilterFiles: enabledCustomFilterFiles(profileId),
    contentBlockingExceptions: contentBlockingExceptions(profileId),
    proxyMode: ((): UserPreferences['proxyMode'] => {
      const v = getSettings(profileId, 'proxyMode', DEFAULT_PROXY_CONFIG.mode)
      return isProxyMode(v) ? v : DEFAULT_PROXY_CONFIG.mode
    })(),
    proxyScheme: ((): UserPreferences['proxyScheme'] => {
      const v = getSettings(profileId, 'proxyScheme', DEFAULT_PROXY_CONFIG.scheme)
      return isProxyScheme(v) ? v : DEFAULT_PROXY_CONFIG.scheme
    })(),
    proxyHost: normalizeProxyHost(getSettings(profileId, 'proxyHost', DEFAULT_PROXY_CONFIG.host)),
    proxyPort: normalizeProxyPort(getSettings(profileId, 'proxyPort', DEFAULT_PROXY_CONFIG.port)),
    proxyBypassRules: normalizeProxyBypassRules(
      getSettings(profileId, 'proxyBypassRules', DEFAULT_PROXY_CONFIG.bypassRules)
    ),
    spellcheck: getSettings(profileId, 'spellcheck', true) !== false,
    showHomeButton: getSettings(profileId, 'showHomeButton', false) === true,
    homeUrl:
      typeof getSettings(profileId, 'homeUrl', DEFAULT_NEW_TAB_URL) === 'string'
        ? (getSettings(profileId, 'homeUrl', DEFAULT_NEW_TAB_URL) as string)
        : DEFAULT_NEW_TAB_URL,
    memorySaver: getSettings(profileId, 'memorySaver', false) === true,
    developerMode: getSettings(profileId, 'developerMode', false) === true,
    userAgent:
      typeof getSettings(profileId, 'userAgent', '') === 'string'
        ? (getSettings(profileId, 'userAgent', '') as string)
        : '',
    preloadTopSites: getSettings(profileId, 'preloadTopSites', false) === true,
    autofillProfiles: getSettings(profileId, 'autofillProfiles', true) !== false,
    autofillPayments: getSettings(profileId, 'autofillPayments', true) !== false,
    saveFormHistory: getSettings(profileId, 'saveFormHistory', true) !== false
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  // Apply the persisted theme before any renderer starts.
  nativeTheme.themeSource = getThemeMode()

  // Use the sender's browser window first: context.getWindow() falls back to
  // the active window for settings IPC, which would misroute profile actions.
  const profileFor = (event?: SenderEvent): string =>
    windowForAnyWebContents(event?.sender)?.profile ??
    (event?.sender ? settingsProfileFor(event.sender) : null) ??
    activeWindow()?.profile ??
    DEFAULT_PROFILE_ID

  const extensionIdForSender = (sender: WebContents): string | null => {
    try {
      const url = new URL(sender.getURL())
      return url.protocol === 'chrome-extension:' ? url.host : null
    } catch {
      return null
    }
  }

  const profileForSender = (sender: WebContents): string =>
    windowForWebContents(sender)?.profile ??
    settingsProfileFor(sender) ??
    activeWindow()?.profile ??
    DEFAULT_PROFILE_ID

  const autofillScopeFor = createAutofillScopeResolver(createEphemeralAutofillStore)
  const scopeForAutofillEvent = (event: SenderEvent): AutofillScope =>
    autofillScopeFor(windowForAnyWebContents(event?.sender) ?? null, profileFor(event))

  // Settings windows have no browser WindowController, so only browser senders
  // may resolve to an incognito counter scope. The chrome view uses the default
  // Electron session, so derive the scope from its owning window instead.
  const blockingStatsKey = (sender: WebContents): string | undefined => {
    const owner = windowForAnyWebContents(sender)
    return owner?.isIncognito ? (owner.partition ?? undefined) : undefined
  }

  const publishAutofill = (scope: AutofillScope): ReturnType<typeof currentAutofillState> => {
    const state = currentAutofillState(scope.profileId, scope.store)
    if (!scope.ephemeral) {
      // Normal autofill state is profile-scoped, but incognito windows must not
      // receive (or persist) the owning profile's saved values.
      for (const window of allWindows()) {
        if (window.profile === scope.profileId && !window.isIncognito) {
          window.sendToChrome(IpcChannels.AutofillStateChanged, state)
        }
      }
      sendToSettingsWindow(scope.profileId, IpcChannels.AutofillStateChanged, state)
    }
    return state
  }

  const sendToProfile = (profileId: string, channel: string, payload?: unknown): void =>
    broadcastToProfile(profileId, channel, payload)

  // Background list refreshes publish updated preferences so a rejected
  // custom URL is visible in Settings without another user action.
  setFilterListStatusListener((profileId) => {
    sendToProfile(profileId, IpcChannels.SettingsChanged, userPreferences(profileId))
  })

  configurePermissionPromptRouter((webContents) => {
    const window = windowForAnyWebContents(webContents) ?? context.getWindow()
    if (!window) return null
    return {
      tabId: webContents ? window.tabIdForWebContents(webContents) : null,
      send: (channel, payload) => window.sendToChrome(channel, payload)
    }
  })

  ipcMain.handle(IpcChannels.AppGetInfo, (): AppVersionInfo => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    dev: !app.isPackaged
  }))

  ipcMain.handle(IpcChannels.CertificateGet, (event, url: string) => {
    void event
    return getCertificate(url)
  })

  ipcMain.handle(
    IpcChannels.CertificateExport,
    (event, url: string, format: CertificateExportFormat) => {
      void event
      return exportCertificate(url, format)
    }
  )

  ipcMain.handle(IpcChannels.DefaultBrowserGet, (event) => (void event, isDefaultBrowser()))
  ipcMain.handle(IpcChannels.DefaultBrowserSet, (event) => (void event, setDefaultBrowser()))

  ipcMain.handle(IpcChannels.SettingsOpen, (event, target?: SettingsTarget) => {
    return openSettingsWindow(target, profileFor(event as any))
  })

  ipcMain.handle(IpcChannels.SettingsGet, (event) => userPreferences(profileFor(event as any)))

  const supportedSettings = new Set<keyof UserPreferences>([
    'clearHistory',
    'clearDownloads',
    'clearBookmarks',
    'clearCookies',
    'clearLocalStorage',
    'clearIndexedDb',
    'clearCache',
    'clearSitePermissions',
    'openDownloadsWhenDone',
    'searchEngine',
    'restoreSession',
    'verticalTabs',
    'contentBlocking',
    'builtinFilterList',
    'filterLists',
    'customFilterLists',
    'contentBlockingExceptions',
    'proxyMode',
    'proxyScheme',
    'proxyHost',
    'proxyPort',
    'proxyBypassRules',
    'spellcheck',
    'showHomeButton',
    'homeUrl',
    'memorySaver',
    'developerMode',
    'userAgent',
    'preloadTopSites',
    'autofillProfiles',
    'autofillPayments',
    'saveFormHistory'
  ])

  ipcMain.handle(
    IpcChannels.SettingsSet,
    async (
      _event,
      key: keyof UserPreferences,
      value: boolean | string | string[] | number
    ): Promise<UserPreferences> => {
      if (!supportedSettings.has(key)) {
        throw new Error(`Unsupported setting: ${key}`)
      }
      const profileId = profileFor(_event as any)
      const respond = (): UserPreferences => {
        const prefs = userPreferences(profileId)
        sendToProfile(profileId, IpcChannels.SettingsChanged, prefs)
        return prefs
      }
      const applyProxy = async (): Promise<void> => {
        await applyProxyForProfile(sessionForProfile(profileId), profileId)
      }
      if (key === 'searchEngine') {
        if (!isSearchEngineId(value)) {
          throw new Error(`Unknown search engine: ${String(value)}`)
        }
        setSettings(profileId, 'searchEngine', value)
        // Open start pages show the active engine; rebuild them in place.
        for (const window of allWindows()) {
          if (window.profile === profileId) window.tabs.refreshStartPages()
        }
        return respond()
      }
      if (key === 'verticalTabs') {
        const enabled = value === true
        setSettings(profileId, 'verticalTabs', enabled)
        for (const window of allWindows()) {
          if (window.profile === profileId) window.setVerticalTabs(enabled)
        }
        return respond()
      }
      if (key === 'builtinFilterList') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: builtinFilterList')
        }
        setSettings(profileId, 'builtinFilterList', value)
        syncContentBlocking(profileId)
        return respond()
      }
      if (key === 'filterLists') {
        if (
          !Array.isArray(value) ||
          !value.every((id) => typeof id === 'string' && isFilterListId(id))
        ) {
          throw new Error('Expected an array of filter list ids')
        }
        setSettings(profileId, 'filterLists', [...new Set(value)])
        syncContentBlocking(profileId)
        return respond()
      }
      if (key === 'customFilterLists') {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          throw new Error('Expected an array of custom filter list URLs')
        }
        const urls = value
          .map((entry) => normalizeCustomFilterUrl(entry))
          .filter((entry): entry is string => entry !== null)
        setSettings(profileId, 'customFilterLists', [...new Set(urls)])
        syncContentBlocking(profileId)
        return respond()
      }
      if (key === 'contentBlockingExceptions') {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          throw new Error('Expected an array of hostnames')
        }
        setContentBlockingExceptions(profileId, value)
        return respond()
      }
      if (key === 'contentBlocking') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: contentBlocking')
        }
        setSettings(profileId, key, value)
        if (value) {
          primeContentBlocking(profileId)
          syncContentBlocking(profileId)
        }
        return respond()
      }
      if (key === 'spellcheck') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: spellcheck')
        }
        setSettings(profileId, key, value)
        sessionForProfile(profileId).setSpellCheckerEnabled(value)
        return respond()
      }
      if (key === 'developerMode') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: developerMode')
        }
        setSettings(profileId, key, value)
        refreshAppMenu()
        return respond()
      }
      if (key === 'userAgent') {
        if (typeof value !== 'string') throw new Error('Invalid user agent')
        setSettings(profileId, 'userAgent', value)
        applyUserAgentForProfile(sessionForProfile(profileId), profileId)
        refreshAppMenu()
        return respond()
      }
      if (key === 'proxyMode') {
        if (!isProxyMode(value)) throw new Error('Invalid proxy mode')
        setSettings(profileId, 'proxyMode', value)
        await applyProxy()
        return respond()
      }
      if (key === 'proxyScheme') {
        if (!isProxyScheme(value)) throw new Error('Invalid proxy scheme')
        setSettings(profileId, 'proxyScheme', value)
        await applyProxy()
        return respond()
      }
      if (key === 'proxyHost') {
        if (typeof value !== 'string') throw new Error('Invalid proxy host')
        setSettings(profileId, 'proxyHost', normalizeProxyHost(value))
        await applyProxy()
        return respond()
      }
      if (key === 'proxyPort') {
        setSettings(profileId, 'proxyPort', normalizeProxyPort(value))
        await applyProxy()
        return respond()
      }
      if (key === 'proxyBypassRules') {
        if (typeof value !== 'string') throw new Error('Invalid proxy bypass rules')
        setSettings(profileId, 'proxyBypassRules', normalizeProxyBypassRules(value))
        await applyProxy()
        return respond()
      }
      if (key === 'homeUrl') {
        if (typeof value !== 'string') throw new Error('Invalid home URL')
        const trimmed = value.trim()
        setSettings(profileId, 'homeUrl', trimmed || DEFAULT_NEW_TAB_URL)
        return respond()
      }
      if (key === 'preloadTopSites') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: preloadTopSites')
        }
        setSettings(profileId, key, value)
        if (value) void runTopSitesPreload(sessionForProfile(profileId), profileId)
        return respond()
      }
      if (typeof value !== 'boolean') {
        throw new Error(`Expected a boolean for setting: ${key}`)
      }
      setSettings(profileId, key, value)
      return respond()
    }
  )

  ipcMain.handle(
    IpcChannels.ContentBlockingImportFile,
    (event, input: { name?: unknown; content?: unknown }) => {
      const profileId = profileFor(event)
      const name = typeof input?.name === 'string' ? input.name : 'Custom hosts list'
      const content = typeof input?.content === 'string' ? input.content : ''
      if (!content) throw new Error('No file content was provided.')
      const file = importCustomFilterFile(profileId, name, content)
      setSettings(profileId, 'customFilterFiles', [...enabledCustomFilterFiles(profileId), file])
      syncContentBlocking(profileId)
      const prefs = userPreferences(profileId)
      sendToProfile(profileId, IpcChannels.SettingsChanged, prefs)
      return prefs
    }
  )

  ipcMain.handle(IpcChannels.ContentBlockingRemoveFile, (event, id: string) => {
    const profileId = profileFor(event)
    if (typeof id !== 'string') throw new Error('Invalid filter file id')
    removeCustomFilterFile(profileId, id)
    setSettings(
      profileId,
      'customFilterFiles',
      enabledCustomFilterFiles(profileId).filter((file) => file.id !== id)
    )
    syncContentBlocking(profileId)
    const prefs = userPreferences(profileId)
    sendToProfile(profileId, IpcChannels.SettingsChanged, prefs)
    return prefs
  })

  ipcMain.handle(IpcChannels.ContentBlockingGetStats, (event) => {
    const profileId =
      windowForAnyWebContents(event.sender)?.profile ??
      settingsProfileFor(event.sender) ??
      profileFor(event)
    const pageContentsId = windowForAnyWebContents(event.sender)?.tabs.activeWebContentsId() ?? null
    return contentBlockingStats(profileId, pageContentsId, blockingStatsKey(event.sender))
  })

  ipcMain.handle(
    IpcChannels.ContentBlockingSetSiteEnabled,
    (event, site: string, enabled: boolean) => {
      const profileId =
        windowForAnyWebContents(event.sender)?.profile ??
        settingsProfileFor(event.sender) ??
        profileFor(event)
      if (typeof site !== 'string') throw new Error('Invalid site')
      if (typeof enabled !== 'boolean') throw new Error('Invalid enabled flag')
      setContentBlockingSiteEnabled(profileId, site, enabled)
      sendToProfile(profileId, IpcChannels.SettingsChanged, userPreferences(profileId))
      const pageContentsId =
        windowForAnyWebContents(event.sender)?.tabs.activeWebContentsId() ?? null
      return contentBlockingStats(profileId, pageContentsId, blockingStatsKey(event.sender))
    }
  )

  /* ---- theme ----------------------------------------------------------- */

  ipcMain.handle(IpcChannels.ThemeGet, (): ThemeState => currentThemeState())

  ipcMain.handle(IpcChannels.ThemeSet, (event, mode: ThemeMode): ThemeState => {
    void event
    const state = applyThemeMode(mode)
    broadcastToAll(IpcChannels.ThemeChanged, state)
    return state
  })

  // Push live updates when 'system' changes as the OS theme flips.
  nativeTheme.on('updated', () => {
    broadcastToAll(IpcChannels.ThemeChanged, currentThemeState())
  })

  /* ---- tabs ------------------------------------------------------------ */

  ipcMain.handle(
    IpcChannels.TabsGetState,
    (event) => context.getWindow(event as any)?.tabs.snapshot() ?? null
  )

  ipcMain.handle(IpcChannels.TabsCreate, (event, request: NewTabRequest) =>
    context.getWindow(event as any)?.tabs.create(request)
  )

  ipcMain.handle(
    IpcChannels.ExtensionTabsCreate,
    (
      event,
      details: { url?: unknown; active?: unknown; index?: unknown } | undefined
    ): number | null => {
      const rawUrl = typeof details?.url === 'string' ? details.url : ''
      let url: string
      try {
        const resolved = new URL(rawUrl, event.sender.getURL())
        if (
          resolved.protocol !== 'http:' &&
          resolved.protocol !== 'https:' &&
          resolved.protocol !== 'chrome-extension:'
        ) {
          return null
        }
        url = resolved.toString()
      } catch {
        return null
      }
      // Extension service workers are not attached to a browser window, so use
      // a window from the same profile when the sender cannot resolve one.
      const owner =
        windowForAnyWebContents(event.sender) ??
        allWindows().find((window) => window.profile === profileForSender(event.sender)) ??
        activeWindow()
      if (!owner) return null
      const tabId = owner.tabs.create({
        url,
        active: details?.active !== false,
        index: typeof details?.index === 'number' ? details.index : undefined
      })
      return owner.tabs.webContentsIdForTab(tabId)
    }
  )

  ipcMain.handle(IpcChannels.TabsClose, (event, id: string) =>
    context.getWindow(event as any)?.tabs.close(id)
  )

  ipcMain.handle(IpcChannels.TabsActivate, (event, id: string) =>
    context.getWindow(event as any)?.tabs.activate(id)
  )

  ipcMain.handle(IpcChannels.TabsReorder, (event, ids: string[]) =>
    context.getWindow(event as any)?.tabs.reorder(ids)
  )

  ipcMain.handle(IpcChannels.TabsPinToggle, (event, id: string) =>
    context.getWindow(event as any)?.tabs.pinToggle(id)
  )

  ipcMain.handle(IpcChannels.TabsDuplicate, (event, id: string) =>
    context.getWindow(event as any)?.tabs.duplicate(id)
  )

  ipcMain.handle(IpcChannels.TabsMuteToggle, (event, id: string) =>
    context.getWindow(event as any)?.tabs.muteToggle(id)
  )

  ipcMain.handle(IpcChannels.TabsCloseOthers, (event, id: string) =>
    context.getWindow(event as any)?.tabs.closeOthers(id)
  )

  ipcMain.handle(IpcChannels.TabsCloseToRight, (event, id: string) =>
    context.getWindow(event as any)?.tabs.closeToRight(id)
  )

  ipcMain.handle(IpcChannels.TabsCopyUrl, (event, id: string) => {
    const tab = context
      .getWindow(event as any)
      ?.tabs.snapshot()
      .tabs.find((tab) => tab.id === id)
    if (tab) clipboard.writeText(tab.url)
    return tab?.url
  })

  ipcMain.handle(IpcChannels.TabsOpenSplit, (event, firstId: string, secondId: string) =>
    context.getWindow(event as any)?.tabs.openSplit(firstId, secondId)
  )

  ipcMain.handle(IpcChannels.TabsCloseSplit, (event) =>
    context.getWindow(event as any)?.tabs.closeSplit()
  )

  /* ---- navigation ------------------------------------------------------ */

  ipcMain.handle(IpcChannels.NavBack, (event) => context.getWindow(event as any)?.tabs.goBack())
  ipcMain.handle(IpcChannels.NavForward, (event) =>
    context.getWindow(event as any)?.tabs.goForward()
  )
  ipcMain.handle(IpcChannels.NavReload, (event, id?: string) =>
    context.getWindow(event as any)?.tabs.reload(id)
  )
  ipcMain.handle(IpcChannels.NavStop, (event) => context.getWindow(event as any)?.tabs.stop())
  ipcMain.handle(IpcChannels.NavGo, (event, url: string) =>
    context.getWindow(event as any)?.tabs.navigate(url)
  )
  ipcMain.handle(IpcChannels.NavForceReload, (event) =>
    context.getWindow(event as any)?.tabs.reloadIgnoringCache()
  )
  ipcMain.handle(IpcChannels.NavFindInPage, (event, query: string, forward?: boolean) =>
    context.getWindow(event as any)?.tabs.findInPage(query, forward ?? true)
  )
  ipcMain.handle(IpcChannels.NavStopFindInPage, (event) =>
    context.getWindow(event as any)?.tabs.stopFindInPage()
  )
  ipcMain.handle(IpcChannels.NavZoomIn, (event) => context.getWindow(event as any)?.tabs.zoomIn())
  ipcMain.handle(IpcChannels.NavZoomOut, (event) => context.getWindow(event as any)?.tabs.zoomOut())
  ipcMain.handle(IpcChannels.NavZoomReset, (event) =>
    context.getWindow(event as any)?.tabs.zoomReset()
  )
  ipcMain.handle(IpcChannels.NavPrint, (event) => context.getWindow(event as any)?.tabs.print())
  ipcMain.handle(IpcChannels.NavPrintToPdf, async (event) => {
    const buf = await context.getWindow(event as any)?.tabs.printToPdf()
    return buf ? buf.toString('base64') : null
  })
  ipcMain.handle(IpcChannels.DevToolsToggle, (event) =>
    context.getWindow(event as any)?.tabs.toggleDevTools()
  )

  ipcMain.handle(IpcChannels.TabsReopenLastClosed, (event) =>
    context.getWindow(event as any)?.tabs.reopenLastClosed()
  )

  /* ---- bookmarks ------------------------------------------------------ */

  const broadcastBookmarks =
    (profileId: string) =>
    (state: BookmarksState, stateProfileId?: string): void =>
      sendToProfile(stateProfileId ?? profileId, IpcChannels.BookmarksStateChanged, state)

  // The internal clipboard is app-wide: every profile's chrome needs to know
  // when a node was copied elsewhere so Paste can be enabled immediately.
  const broadcastBookmarkClipboard = (): void =>
    broadcastToAll(IpcChannels.BookmarksClipboardChanged, currentBookmarkClipboard())

  ipcMain.handle(IpcChannels.BookmarksGetState, (event) =>
    currentBookmarksState(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.BookmarksAdd, (event, input: NewBookmarkInput) => {
    const profileId = profileFor(event as any)
    return addBookmark(profileId, input, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksRemove, (event, id: string) => {
    const profileId = profileFor(event as any)
    return removeBookmark(profileId, id, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksUpdate, (event, id: string, patch: BookmarkPatch) => {
    const profileId = profileFor(event as any)
    return updateBookmark(profileId, id, patch, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksAddFolder, (event, input: NewBookmarkFolderInput) => {
    const profileId = profileFor(event as any)
    return addFolder(profileId, input, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
  })

  /* ---- site permissions ------------------------------------------------ */

  const publishPermissions = (profileId: string): SitePermissionsState => {
    const state = currentSitePermissions(profileId)
    sendToProfile(profileId, IpcChannels.PermissionsStateChanged, state)
    return state
  }

  ipcMain.handle(IpcChannels.PermissionsGetState, (event) =>
    currentSitePermissions(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.PermissionsGetForOrigin, (event, origin: string) => {
    const profileId = profileFor(event as any)
    return typeof origin === 'string'
      ? sitePermissionsForOrigin(profileId, origin)
      : { decisions: [] }
  })

  ipcMain.handle(IpcChannels.PermissionsRemove, (event, origin: string, kind?: PermissionKind) => {
    const profileId = profileFor(event as any)
    if (typeof origin !== 'string') throw new Error('Invalid permission origin')
    if (kind !== undefined && !isPermissionKind(kind)) {
      throw new Error(`Invalid permission kind: ${String(kind)}`)
    }
    const changed = removeSitePermissions(profileId, origin, kind)
    return changed ? publishPermissions(profileId) : currentSitePermissions(profileId)
  })

  ipcMain.handle(IpcChannels.PermissionsClear, (event) => {
    const profileId = profileFor(event as any)
    const changed = clearSitePermissions(profileId)
    return changed ? publishPermissions(profileId) : currentSitePermissions(profileId)
  })

  ipcMain.handle(IpcChannels.PermissionsUndoAutoRemoval, (event) => {
    const profileId = profileFor(event as any)
    const changed = undoPermissionAutoRemoval(profileId)
    return changed ? publishPermissions(profileId) : currentSitePermissions(profileId)
  })

  ipcMain.handle(
    IpcChannels.PermissionsRespond,
    (_event, id: string, choice: PermissionRequestChoice) => {
      if (typeof id !== 'string' || !isPermissionRequestChoice(choice)) {
        throw new Error('Invalid permission response')
      }
      const result = respondToPermissionRequest(id, choice)
      if (result.changed && result.profileId) publishPermissions(result.profileId)
      return result.handled
    }
  )

  /* ---- browsing data --------------------------------------------------- */

  type StorageKind = 'cookies' | 'localstorage' | 'indexdb'

  ipcMain.handle(
    IpcChannels.BrowsingDataClear,
    async (_event, options: ClearBrowsingDataOptions): Promise<void> => {
      if (!options || typeof options !== 'object') {
        throw new Error('Invalid browsing data options')
      }

      const storages: StorageKind[] = []
      if (options.cookies === true) storages.push('cookies')
      if (options.localStorage === true) storages.push('localstorage')
      if (options.indexedDb === true) storages.push('indexdb')

      const profileId = profileFor(_event as any)
      const ses = sessionForProfile(profileId)
      if (storages.length > 0) {
        await ses.clearStorageData({ storages })
      }
      if (options.cache === true) {
        await ses.clearCache()
      }
      if (options.sitePermissions === true && clearSitePermissions(profileId)) {
        publishPermissions(profileId)
      }
      if (options.formHistory === true || options.autofillData === true) {
        const store = storesFor(profileId).autofill
        if (options.formHistory === true) store.set('formHistory', [])
        if (options.autofillData === true) {
          store.set('addresses', [])
          store.set('contacts', [])
          store.set('paymentMethods', [])
        }
      }
    }
  )

  ipcMain.handle(
    IpcChannels.BookmarksUpdateFolder,
    (event, id: string, patch: BookmarkFolderPatch) => {
      const profileId = profileFor(event as any)
      return updateFolder(profileId, id, patch, broadcastBookmarks(profileId))
    }
  )

  ipcMain.handle(IpcChannels.BookmarksRemoveFolder, (event, id: string) => {
    const profileId = profileFor(event as any)
    const state = removeFolder(profileId, id, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
    broadcastBookmarkClipboard()
    return state
  })

  ipcMain.handle(IpcChannels.BookmarksMove, (event, input: BookmarkMoveInput) => {
    const profileId = profileFor(event as any)
    return moveBookmarkNode(profileId, input, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksCopy, (event, kind: BookmarkNodeKind, id: string) => {
    const profileId = profileFor(event as any)
    const state = copyBookmarkNode(profileId, kind, id, broadcastBookmarks(profileId))
    broadcastBookmarkClipboard()
    return state
  })

  ipcMain.handle(IpcChannels.BookmarksCut, (event, kind: BookmarkNodeKind, id: string) => {
    const profileId = profileFor(event as any)
    const state = cutBookmarkNode(profileId, kind, id, broadcastBookmarks(profileId))
    broadcastBookmarkClipboard()
    return state
  })

  ipcMain.handle(IpcChannels.BookmarksPaste, (event, parentId: string | null) => {
    const profileId = profileFor(event as any)
    const state = pasteBookmarkNode(
      profileId,
      parentId,
      broadcastBookmarks(profileId),
      (targetProfileId, visible) => setBookmarksBarVisibleForProfile(targetProfileId, visible)
    )
    broadcastBookmarkClipboard()
    return state
  })

  ipcMain.handle(
    IpcChannels.BookmarksConsumeDragUrl,
    (event) => (void event, consumePendingDragUrl())
  )

  ipcMain.handle(IpcChannels.BookmarksOpenWindow, (event, url: string) => {
    context.openWindow?.(url, profileFor(event as any))
  })

  ipcMain.handle(IpcChannels.BookmarksOpenIncognitoWindow, (event, url: string) => {
    context.openIncognitoWindow?.(url, profileFor(event as any))
  })

  ipcMain.handle(IpcChannels.WindowsOpen, (event, url?: string) => {
    context.openWindow?.(url, profileFor(event as any))
  })

  ipcMain.handle(IpcChannels.WindowsOpenIncognito, (event, url?: string) => {
    context.openIncognitoWindow?.(url, profileFor(event as any))
  })

  ipcMain.handle(IpcChannels.WindowsGetState, (event): WindowState => {
    const window = context.getWindow(event as any)
    return {
      incognito: window?.isIncognito ?? false,
      profile: window?.profileInfo ?? {
        id: DEFAULT_PROFILE_ID,
        name: 'Default',
        createdAt: 0,
        isDefault: true
      },
      // Maximize is distinct from fullscreen: window chrome and its reserved
      // clearance remain present in maximized and normal states alike.
      maximized: window?.window.isMaximized() ?? false
    }
  })

  ipcMain.handle(IpcChannels.WindowsSetTitle, (event, title: string) => {
    context.getWindow(event as any)?.setWindowTitle(title)
  })

  // Resolve the sender's window so a control affects only the window that owns it.
  ipcMain.handle(IpcChannels.WindowsMinimize, (event) => {
    context.getWindow(event as any)?.window.minimize()
  })

  ipcMain.handle(IpcChannels.WindowsToggleMaximize, (event) => {
    const window = context.getWindow(event as any)?.window
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(IpcChannels.WindowsClose, (event) => {
    context.getWindow(event as any)?.window.close()
  })

  ipcMain.handle(IpcChannels.BookmarksClear, (event) => {
    const profileId = profileFor(event as any)
    const state = clearBookmarks(profileId, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
    broadcastBookmarkClipboard()
    return state
  })

  ipcMain.handle(IpcChannels.BookmarksToggleBar, (event) => {
    const profileId = profileFor(event as any)
    return toggleBookmarksBar(profileId, broadcastBookmarks(profileId), (visible) =>
      setBookmarksBarVisibleForProfile(profileId, visible)
    )
  })

  ipcMain.on(IpcChannels.TabDragStart, (event, url: string) => {
    void event
    setPendingDragUrl(url)
  })

  ipcMain.on(IpcChannels.TabGetUserAgent, (event) => {
    // A normal tab's persistent session identifies its profile directly.
    // Incognito tabs use an in-memory partition, so they need the window-based
    // fallback to inherit the profile that opened them.
    const sessionProfile = listProfiles().find((profile) => {
      try {
        return sessionForProfile(profile.id) === event.sender.session
      } catch {
        return false
      }
    })
    const profileId = sessionProfile?.id ?? profileForSender(event.sender)
    event.returnValue = userAgentForProfile(profileId)
  })

  // Tabs block inside sendSync until the chrome UI answers the prompt.
  ipcMain.on(
    IpcChannels.TabPrompt,
    (event, payload: { message?: unknown; defaultValue?: unknown }) => {
      const window = windowForWebContents(event.sender)
      if (!window) {
        event.returnValue = null
        return
      }
      requestPrompt(window, event, payload)
    }
  )

  ipcMain.handle(
    IpcChannels.PromptRespond,
    (_event, response: { id?: unknown; value?: unknown }) => {
      if (typeof response?.id !== 'string') return
      respondToPrompt(response.id, response.value)
    }
  )
  /* ---- history --------------------------------------------------------- */

  ipcMain.handle(IpcChannels.HistoryGetState, (event) =>
    currentHistoryState(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.HistoryRecordVisit, (event, visit: { url: string; title: string }) => {
    const profileId = profileFor(event as any)
    recordVisit(profileId, visit)
    return publishHistory(profileId, (state) =>
      sendToProfile(profileId, IpcChannels.HistoryStateChanged, state)
    )
  })

  ipcMain.handle(IpcChannels.HistoryRemove, (event, id: string) => {
    const profileId = profileFor(event as any)
    removeHistory(profileId, id)
    return publishHistory(profileId, (state) =>
      sendToProfile(profileId, IpcChannels.HistoryStateChanged, state)
    )
  })

  ipcMain.handle(IpcChannels.HistoryClear, (event) => {
    const profileId = profileFor(event as any)
    clearHistory(profileId)
    return publishHistory(profileId, (state) =>
      sendToProfile(profileId, IpcChannels.HistoryStateChanged, state)
    )
  })

  /* ---- autofill -------------------------------------------------------- */

  ipcMain.handle(IpcChannels.AutofillGetState, (event) => {
    const scope = scopeForAutofillEvent(event as any)
    return currentAutofillState(scope.profileId, scope.store)
  })

  ipcMain.handle(IpcChannels.AutofillSaveAddress, (event, input) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid address')
    const scope = scopeForAutofillEvent(event as any)
    saveAddress(scope.profileId, input as any, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillDeleteAddress, (event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid address id')
    const scope = scopeForAutofillEvent(event as any)
    deleteAddress(scope.profileId, id, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillSaveContact, (event, input) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid contact')
    const scope = scopeForAutofillEvent(event as any)
    saveContact(scope.profileId, input as any, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillDeleteContact, (event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid contact id')
    const scope = scopeForAutofillEvent(event as any)
    deleteContact(scope.profileId, id, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillSavePayment, (event, input) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid payment method')
    const scope = scopeForAutofillEvent(event as any)
    savePaymentMethod(scope.profileId, input as any, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillDeletePayment, (event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid payment method id')
    const scope = scopeForAutofillEvent(event as any)
    deletePaymentMethod(scope.profileId, id, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillClearFormHistory, (event) => {
    const scope = scopeForAutofillEvent(event as any)
    clearFormHistory(scope.profileId, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(IpcChannels.AutofillDeleteFormHistoryEntry, (event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid form history id')
    const scope = scopeForAutofillEvent(event as any)
    removeFormHistoryEntry(scope.profileId, id, scope.store)
    return publishAutofill(scope)
  })

  ipcMain.handle(
    IpcChannels.AutofillGetFormSuggestions,
    (event, payload: { field?: unknown; prefix?: unknown }) => {
      const scope = scopeForAutofillEvent(event as any)
      if (typeof payload?.field !== 'string') return []
      return getFormHistorySuggestions(
        scope.profileId,
        payload.field,
        typeof payload.prefix === 'string' ? payload.prefix : '',
        scope.store
      )
    }
  )

  ipcMain.handle(
    IpcChannels.AutofillRecordFormField,
    (event, payload: { field?: unknown; value?: unknown }) => {
      const scope = scopeForAutofillEvent(event as any)
      if (typeof payload?.field !== 'string' || typeof payload?.value !== 'string') return
      recordFormHistory(scope.profileId, payload.field, payload.value, scope.store)
    }
  )

  ipcMain.handle(IpcChannels.AutofillGetFillData, (event, payload: { kind?: unknown }) => {
    const scope = scopeForAutofillEvent(event as any)
    const kind = payload?.kind
    if (kind !== 'address' && kind !== 'contact' && kind !== 'payment') return []
    return getAutofillProfileSuggestions(scope.profileId, kind, scope.store)
  })

  /* ---- extensions ------------------------------------------------------ */

  const publishExtensions = (profileId: string, state: ExtensionInfo[]): ExtensionInfo[] => {
    sendToProfile(profileId, IpcChannels.ExtensionsStateChanged, state)
    return state
  }

  /** Panel currently open in each window, so a second click acts as a toggle. */
  const openExtensionPanels = new WeakMap<
    WindowController,
    { id: string; kind: string; anchor?: { x: number; y: number } }
  >()

  const closePanelForOwner = (owner: WindowController): void => {
    if (!openExtensionPanels.has(owner)) return
    owner.closeExtensionPanel()
    openExtensionPanels.delete(owner)
  }

  ipcMain.handle(IpcChannels.ExtensionsGetState, (event) => {
    const profileId = profileFor(event as any)
    return currentExtensionsState(sessionForProfile(profileId), profileId)
  })

  ipcMain.handle(IpcChannels.ExtensionsChooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load unpacked extension',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.ExtensionsChooseCrx, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Install CRX extension',
      filters: [{ name: 'Chrome extensions', extensions: ['crx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.ExtensionsInstall, async (event, path: unknown) => {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('Choose an extension folder or CRX file first.')
    }
    const profileId = profileFor(event as any)
    const state = await installExtension(sessionForProfile(profileId), profileId, path)
    return publishExtensions(profileId, state)
  })

  ipcMain.handle(IpcChannels.ExtensionsInstallFromStore, async (event, input: unknown) => {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new Error('Enter a Chrome Web Store URL or extension id.')
    }
    const profileId = profileFor(event as any)
    const state = await installExtensionFromStore(sessionForProfile(profileId), profileId, input)
    return publishExtensions(profileId, state)
  })

  ipcMain.handle(IpcChannels.ExtensionsUninstall, (event, path: unknown) => {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('No extension selected.')
    }
    const profileId = profileFor(event as any)
    const ses = sessionForProfile(profileId)
    const extension = ses.extensions
      .getAllExtensions()
      .find((candidate) => resolve(candidate.path) === resolve(path))
    if (extension) {
      for (const window of allWindows()) {
        if (openExtensionPanels.get(window)?.id === extension.id) closePanelForOwner(window)
      }
    }
    const state = uninstallExtension(ses, profileId, path)
    return publishExtensions(profileId, state)
  })

  /** Open an extension action popup inside the browser window, like Chrome. */
  const openExtensionPopup = ({
    extension,
    session,
    profileId,
    resource,
    x,
    y,
    owner,
    toggle = true
  }: {
    extension: Extension
    session: Electron.Session
    profileId: string
    resource: string
    x: number
    y: number
    owner: WindowController | null
    toggle?: boolean
  }): boolean => {
    if (!owner || owner.window.isDestroyed()) return false
    const current = openExtensionPanels.get(owner)
    if (toggle && current?.kind === 'popup' && current.id === extension.id) {
      closePanelForOwner(owner)
      return true
    }
    // Actions opened from the HTML menu should still appear to come from the
    // puzzle button, not from the row that was clicked inside the menu.
    const anchor = current?.kind === 'menu' && current.anchor ? current.anchor : { x, y }
    closePanelForOwner(owner)

    let url: string
    try {
      url = extensionResourceUrl(extension, resource)
    } catch {
      return false
    }
    const openExternal = (target: string): void => {
      if (/^https?:\/\//i.test(target)) context.openWindow?.(target, profileId)
    }
    owner.showExtensionPanel({
      url,
      session,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
      width: 420,
      height: 600,
      allowedOrigin: extension.url,
      onNavigateAway: openExternal
    })
    openExtensionPanels.set(owner, { id: extension.id, kind: 'popup' })
    return true
  }

  ipcMain.handle(
    IpcChannels.ExtensionsOpenPopup,
    (
      event,
      payload: {
        id?: unknown
        resource?: unknown
        x?: unknown
        y?: unknown
      }
    ) => {
      if (typeof payload?.id !== 'string' || typeof payload.resource !== 'string') {
        throw new Error('The extension action is invalid.')
      }
      const profileId = profileFor(event as any)
      const ses = sessionForProfile(profileId)
      const extension = ses.extensions
        .getAllExtensions()
        .find((candidate) => candidate.id === payload.id)
      if (!extension) throw new Error('That extension is no longer loaded.')

      return openExtensionPopup({
        extension,
        session: ses,
        profileId,
        resource: payload.resource,
        x: typeof payload.x === 'number' ? payload.x : 0,
        y: typeof payload.y === 'number' ? payload.y : 0,
        owner: windowForAnyWebContents(event.sender)
      })
    }
  )

  /**
   * Show the Chrome-style HTML action menu in an in-window panel. The chrome
   * view is never resized, so the tab strip and window dragging stay intact.
   */
  /** Called by `chrome.action.openPopup()` from an extension page or worker. */
  ipcMain.handle(IpcChannels.ExtensionActionOpenPopup, async (event): Promise<boolean> => {
    const extensionId = extensionIdForSender(event.sender)
    if (!extensionId) return false
    const profileId = profileForSender(event.sender)
    const ses = sessionForProfile(profileId)
    const extension = ses.extensions
      .getAllExtensions()
      .find((candidate) => candidate.id === extensionId)
    if (!extension) return false
    const resource = currentExtensionsState(ses, profileId).find(
      (candidate) => candidate.id === extensionId
    )?.action?.popup
    if (!resource) return false

    const owner =
      windowForAnyWebContents(event.sender) ??
      allWindows().find((candidate) => candidate.profile === profileId) ??
      activeWindow()
    if (!owner || owner.window.isDestroyed()) return false

    let anchor = { x: 0, y: 0 }
    try {
      const script = `(() => {
        const label = ${JSON.stringify(`Open ${extension.name}`)};
        const buttons = [...document.querySelectorAll('button')];
        const action = buttons.find((button) => button.getAttribute('aria-label') === label);
        const target = action ?? buttons.find((button) => button.getAttribute('aria-label') === 'Extensions');
        const rect = target?.getBoundingClientRect();
        return rect ? { x: rect.right, y: rect.bottom } : { x: 0, y: 0 };
      })()`
      const measured = (await owner.chrome.webContents.executeJavaScript(script)) as {
        x?: unknown
        y?: unknown
      } | null
      if (typeof measured?.x === 'number' && typeof measured?.y === 'number') {
        anchor = { x: measured.x, y: measured.y }
      }
    } catch {
      // The toolbar may still be loading; the popup can still open unanchored.
    }

    return openExtensionPopup({
      extension,
      session: ses,
      profileId,
      resource,
      x: anchor.x,
      y: anchor.y,
      owner,
      toggle: false
    })
  })

  ipcMain.handle(
    IpcChannels.ExtensionsShowActionMenu,
    (event, payload: { x?: unknown; y?: unknown }) => {
      const owner = windowForAnyWebContents(event.sender)
      if (!owner || owner.window.isDestroyed()) return false
      const profileId = owner.profile
      const extensions = currentExtensionsState(sessionForProfile(profileId), profileId)
      if (extensions.length === 0) return false

      const state = owner.tabs.snapshot()
      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      const x = Math.round(typeof payload?.x === 'number' ? payload.x : 0)
      const y = Math.round(typeof payload?.y === 'number' ? payload.y : 0)
      const devServerUrl = process.env['ELECTRON_RENDERER_URL']
      const menuUrl = devServerUrl
        ? `${devServerUrl.replace(/\/$/, '')}/extensionMenu.html`
        : 'voyager://extension-menu'
      closePanelForOwner(owner)
      owner.showExtensionPanel({
        url: menuUrl,
        x,
        y,
        width: 372,
        height: 520,
        menuPayload: { site: active?.url ?? null, profileId }
      })
      openExtensionPanels.set(owner, { id: '', kind: 'menu', anchor: { x, y } })
      return true
    }
  )

  ipcMain.handle(IpcChannels.ExtensionsClosePanel, (event) => {
    const owner = windowForAnyWebContents(event.sender)
    if (owner) closePanelForOwner(owner)
  })

  ipcMain.handle(
    IpcChannels.ExtensionsSetPinned,
    (event, payload: { id?: unknown; pinned?: unknown }) => {
      if (typeof payload?.id !== 'string' || typeof payload.pinned !== 'boolean') {
        throw new Error('The extension pin change is invalid.')
      }
      const profileId = profileFor(event as any)
      setExtensionPinned(profileId, payload.id, payload.pinned)
      return publishExtensions(
        profileId,
        currentExtensionsState(sessionForProfile(profileId), profileId)
      )
    }
  )

  ipcMain.handle(
    IpcChannels.ExtensionsSetSiteAccess,
    (event, payload: { id?: unknown; access?: unknown }) => {
      if (
        typeof payload?.id !== 'string' ||
        (payload.access !== 'click' && payload.access !== 'site' && payload.access !== 'all')
      ) {
        throw new Error('The site access choice is invalid.')
      }
      const profileId = profileFor(event as any)
      setExtensionSiteAccess(profileId, payload.id, payload.access)
      return publishExtensions(
        profileId,
        currentExtensionsState(sessionForProfile(profileId), profileId)
      )
    }
  )

  ipcMain.handle(
    IpcChannels.ExtensionPermissionRequest,
    (
      event,
      payload:
        | {
            permissions?: unknown
            origins?: unknown
            mode?: unknown
            checkOnly?: unknown
          }
        | undefined
    ): Promise<boolean | { permissions: string[]; origins: string[] }> => {
      const profileId = profileFor(event as any)
      let extensionId: string | null = null
      try {
        const senderUrl = new URL(event.sender.getURL())
        if (senderUrl.protocol === 'chrome-extension:') extensionId = senderUrl.host
      } catch {
        // Non-extension senders cannot request extension permissions.
      }
      const extension = extensionId
        ? sessionForProfile(profileId)
            .extensions.getAllExtensions()
            .find((candidate) => candidate.id === extensionId)
        : null
      if (!extension || !extensionId) return Promise.resolve(false)

      const manifest = (extension.manifest ?? {}) as Record<string, unknown>
      const declared = new Set<string>()
      for (const key of ['permissions', 'optional_permissions']) {
        const value = manifest[key]
        if (!Array.isArray(value)) continue
        for (const item of value) if (typeof item === 'string') declared.add(item)
      }
      const stringArray = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
      const requested = [
        ...new Set([
          ...stringArray(payload?.permissions),
          ...stringArray(payload?.origins).map(extensionOriginKey)
        ])
      ].filter((item) => declared.has(item.startsWith('origin:') ? item.slice(7) : item))
      if (payload?.mode === 'getAll') {
        return Promise.resolve(extensionPermissionGrants(profileId, extensionId))
      }
      if (payload?.mode === 'remove') {
        removeExtensionPermissions(profileId, extensionId, requested)
        return Promise.resolve(true)
      }
      if (payload?.mode === 'contains' || payload?.checkOnly === true) {
        return Promise.resolve(hasAllExtensionPermissions(profileId, extensionId, requested))
      }
      if (requested.length === 0) return Promise.resolve(true)

      const routeWindow =
        windowForAnyWebContents(event.sender) ??
        allWindows().find((candidate) => candidate.profile === profileId) ??
        activeWindow()
      if (!routeWindow) return Promise.resolve(false)

      return requestExtensionPermissions({
        profileId,
        extensionId,
        extensionName: extension.name,
        keys: requested,
        sender: event.sender,
        sendPrompt: (request) =>
          routeWindow.sendToChrome(IpcChannels.ExtensionPermissionRequest, request),
        onCancelled: (id) =>
          routeWindow.sendToChrome(IpcChannels.ExtensionPermissionRequestCancelled, { id })
      })
    }
  )

  ipcMain.handle(IpcChannels.ExtensionPermissionRespond, (_event, id: unknown, choice: unknown) => {
    if (typeof id !== 'string' || !isExtensionPermissionChoice(choice)) {
      throw new Error('Invalid extension permission response')
    }
    const result = respondToExtensionPermission(id, choice)
    if (result.profileId) {
      publishExtensions(
        result.profileId,
        currentExtensionsState(sessionForProfile(result.profileId), result.profileId)
      )
    }
    return result.handled
  })

  ipcMain.handle(IpcChannels.NativeMessagingHostsGet, (event) =>
    getNativeHosts(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.NativeMessagingHostsSet, (event, hosts: unknown) =>
    setNativeHosts(profileFor(event as any), hosts)
  )

  ipcMain.handle(
    IpcChannels.ExtensionNativeConnect,
    (event, hostName: unknown, requestedPortId: unknown): string | null => {
      if (typeof hostName !== 'string') return null
      const portId =
        typeof requestedPortId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(requestedPortId)
          ? requestedPortId
          : undefined
      const extensionId = extensionIdForSender(event.sender)
      if (!extensionId) return null
      const profileId = profileFor(event as any)
      const sendToSender = (channel: string, payload: unknown): void => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
      }
      try {
        return connectNative(
          {
            profileId,
            hostName,
            extensionId,
            sender: event.sender,
            onMessage: (message, id) =>
              sendToSender(IpcChannels.ExtensionNativeMessageEvent, { portId: id, message }),
            onDisconnect: (id) =>
              sendToSender(IpcChannels.ExtensionNativeDisconnectEvent, { portId: id })
          },
          portId
        )
      } catch (error) {
        console.warn('[nativeMessaging] Could not start host:', error)
        return null
      }
    }
  )

  ipcMain.handle(
    IpcChannels.ExtensionNativePostMessage,
    (event, portId: unknown, message: unknown): boolean =>
      typeof portId === 'string' ? postToNative(portId, event.sender, message) : false
  )

  ipcMain.handle(IpcChannels.ExtensionNativeDisconnect, (event, portId: unknown): boolean =>
    typeof portId === 'string' ? disconnectNative(portId, event.sender) : false
  )

  ipcMain.handle(
    IpcChannels.ExtensionNativeSendMessage,
    async (event, hostName: unknown, message: unknown): Promise<unknown> => {
      if (typeof hostName !== 'string') return null
      const extensionId = extensionIdForSender(event.sender)
      if (!extensionId) return null
      try {
        return await sendNativeMessage(
          {
            profileId: profileFor(event as any),
            hostName,
            extensionId,
            sender: event.sender,
            onMessage: () => {},
            onDisconnect: () => {}
          },
          message
        )
      } catch (error) {
        console.warn('[nativeMessaging] Message failed:', error)
        return null
      }
    }
  )

  const PRIVACY_PASSWORD_SAVING_KEY = 'passwordSavingEnabled'

  ipcMain.handle(IpcChannels.ExtensionPrivacyGet, (event, key: unknown): boolean => {
    if (key !== PRIVACY_PASSWORD_SAVING_KEY) return true
    return getSettings(profileFor(event as any), PRIVACY_PASSWORD_SAVING_KEY, true) !== false
  })

  ipcMain.handle(
    IpcChannels.ExtensionPrivacySet,
    async (event, key: unknown, value: unknown): Promise<boolean> => {
      if (key !== PRIVACY_PASSWORD_SAVING_KEY || typeof value !== 'boolean') return false
      const extensionId = extensionIdForSender(event.sender)
      if (!extensionId) return false
      const profileId = profileFor(event as any)
      const extension = sessionForProfile(profileId)
        .extensions.getAllExtensions()
        .find((candidate) => candidate.id === extensionId)
      if (!extension) return false

      const manifest = (extension.manifest ?? {}) as Record<string, unknown>
      const declared = new Set<string>()
      for (const field of ['permissions', 'optional_permissions']) {
        const values = manifest[field]
        if (!Array.isArray(values)) continue
        for (const item of values) if (typeof item === 'string') declared.add(item)
      }
      if (!declared.has('privacy')) return false

      if (!hasAllExtensionPermissions(profileId, extensionId, ['privacy'])) {
        const routeWindow =
          windowForAnyWebContents(event.sender) ??
          allWindows().find((candidate) => candidate.profile === profileId) ??
          activeWindow()
        if (!routeWindow) return false
        const granted = await requestExtensionPermissions({
          profileId,
          extensionId,
          extensionName: extension.name,
          keys: ['privacy.passwordSavingEnabled'],
          sender: event.sender,
          sendPrompt: (request) =>
            routeWindow.sendToChrome(IpcChannels.ExtensionPermissionRequest, request),
          onCancelled: (id) =>
            routeWindow.sendToChrome(IpcChannels.ExtensionPermissionRequestCancelled, { id })
        })
        if (!granted) return false
        recordExtensionPermissionDecision(profileId, extensionId, ['privacy'], 'allow')
      }

      setSettings(profileId, PRIVACY_PASSWORD_SAVING_KEY, value)
      if (!event.sender.isDestroyed()) {
        event.sender.send(IpcChannels.ExtensionPrivacyChangedEvent, { key, value })
      }
      return true
    }
  )

  /** Three-dots menu for a single extension, using native menu items. */
  ipcMain.handle(
    IpcChannels.ExtensionsShowContextMenu,
    (event, payload: { id?: unknown; x?: unknown; y?: unknown }) => {
      if (typeof payload?.id !== 'string') throw new Error('The extension is invalid.')
      const profileId = profileFor(event as any)
      const ses = sessionForProfile(profileId)
      const extension = ses.extensions
        .getAllExtensions()
        .find((candidate) => candidate.id === payload.id)
      if (!extension) return false
      const owner = windowForAnyWebContents(event.sender)
      const manifest = (extension.manifest ?? {}) as Record<string, unknown>
      const optionsUi = manifest.options_ui as Record<string, unknown> | undefined
      const optionsPage =
        (typeof optionsUi?.page === 'string' ? optionsUi.page : null) ??
        (typeof manifest.options_page === 'string' ? manifest.options_page : null)
      const current = currentExtensionsState(ses, profileId).find(
        (item) => item.id === extension.id
      )
      const siteAccess = current?.siteAccess ?? 'click'
      const hostAccess = hostAccessForManifest(manifest)
      // The three-dots button lives in the panel view, so its coordinates are
      // panel-relative; native menus need window-relative coordinates.
      const panelOrigin = owner?.extensionPanelOrigin()
      const x = Math.round((typeof payload.x === 'number' ? payload.x : 0) + (panelOrigin?.x ?? 0))
      const y = Math.round((typeof payload.y === 'number' ? payload.y : 0) + (panelOrigin?.y ?? 0))
      const closeAnd = (action: () => void): void => {
        if (owner) closePanelForOwner(owner)
        action()
      }
      const activeUrl = (() => {
        if (!owner) return 'about:blank'
        const snapshot = owner.tabs.snapshot()
        const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId)
        return tab?.url ?? 'about:blank'
      })()
      const domain = (() => {
        try {
          return new URL(activeUrl).hostname || 'this site'
        } catch {
          return 'this site'
        }
      })()

      const template: Electron.MenuItemConstructorOptions[] = [
        { label: extension.name, enabled: false },
        { type: 'separator' }
      ]
      if (optionsPage) {
        template.push({
          label: 'Options',
          click: () =>
            closeAnd(() => {
              owner?.tabs.create({
                url: extensionResourceUrl(extension, optionsPage),
                active: true
              })
            })
        })
      }
      if (hostAccess !== 'none') {
        template.push({
          label: 'This extension can read and change site data',
          submenu: (
            [
              ['When you click the extension', 'click'],
              [`On ${domain}`, 'site'],
              ['On all sites', 'all']
            ] as Array<[string, 'click' | 'site' | 'all']>
          ).map(([label, value]) => ({
            label,
            type: 'radio' as const,
            checked: siteAccess === value,
            click: () => {
              setExtensionSiteAccess(profileId, extension.id, value)
              publishExtensions(profileId, currentExtensionsState(ses, profileId))
            }
          }))
        })
      }
      template.push(
        { type: 'separator' },
        {
          label: 'Remove from Voyager',
          click: () => {
            void dialog
              .showMessageBox({
                type: 'warning',
                buttons: ['Cancel', 'Remove'],
                defaultId: 0,
                cancelId: 0,
                message: `Remove ${extension.name} from Voyager?`,
                detail: 'The extension will be uninstalled for this profile.'
              })
              .then(({ response }) => {
                if (response !== 1) return
                if (owner) closePanelForOwner(owner)
                uninstallExtension(ses, profileId, extension.path)
                publishExtensions(profileId, currentExtensionsState(ses, profileId))
              })
          }
        },
        { type: 'separator' },
        {
          label: 'View Web Permissions',
          click: () =>
            closeAnd(() =>
              openSettingsWindow({ page: 'site-permissions', origin: extension.url }, profileId)
            )
        }
      )
      const menu = Menu.buildFromTemplate(template)
      if (owner && !owner.window.isDestroyed()) menu.popup({ window: owner.window, x, y })
      else menu.popup()
      return true
    }
  )

  /* ---- downloads ------------------------------------------------------ */

  ipcMain.handle(IpcChannels.DownloadsGetState, (event) =>
    currentDownloadsState(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.DownloadsClear, (event) => {
    const profileId = profileFor(event as any)
    clearDownloads(profileId)
    return publishDownloads(profileId, (state) =>
      sendToProfile(profileId, IpcChannels.DownloadsStateChanged, state)
    )
  })

  const publishDownloadsState = (profileId: string): ReturnType<typeof publishDownloads> =>
    publishDownloads(profileId, (state) =>
      sendToProfile(profileId, IpcChannels.DownloadsStateChanged, state)
    )

  ipcMain.handle(IpcChannels.DownloadsPause, (event, id: string) => {
    const profileId = profileFor(event as any)
    pauseDownload(id)
    return publishDownloadsState(profileId)
  })

  ipcMain.handle(IpcChannels.DownloadsResume, (event, id: string) => {
    const profileId = profileFor(event as any)
    resumeDownload(id)
    return publishDownloadsState(profileId)
  })

  ipcMain.handle(IpcChannels.DownloadsCancel, (event, id: string) => {
    const profileId = profileFor(event as any)
    cancelDownload(id)
    return publishDownloadsState(profileId)
  })

  ipcMain.handle(IpcChannels.DownloadsRemove, (event, id: string) => {
    const profileId = profileFor(event as any)
    removeDownload(profileId, id)
    return publishDownloadsState(profileId)
  })

  ipcMain.handle(IpcChannels.DownloadsCopyUrl, (event, id: string) => {
    void event
    const profileId = profileFor(event as any)
    const url = downloadUrl(profileId, id)
    if (url) clipboard.writeText(url)
    return url
  })

  ipcMain.handle(IpcChannels.DownloadsOpenFolder, (event, id: string) => {
    void event
    return openDownloadFolder(profileFor(event as any), id)
  })

  /* ---- profiles -------------------------------------------------------- */

  const profilesState = (activeProfileId: string): ProfilesState => ({
    profiles: listProfiles(),
    activeProfileId
  })

  ipcMain.handle(IpcChannels.ProfilesGetState, (event) => profilesState(profileFor(event as any)))

  ipcMain.handle(IpcChannels.ProfilesCreate, (event, input: CreateProfileInput) => {
    if (!input || typeof input.name !== 'string') throw new Error('Profile name is required')
    const profile = createProfile({
      name: input.name,
      picture: input.picture
    })
    ensureProfileSession(profile.id)
    broadcastProfiles()
    void event
    return profile
  })

  ipcMain.handle(IpcChannels.ProfilesUpdate, (event, input: RenameProfileInput) => {
    if (!input || typeof input.id !== 'string' || typeof input.name !== 'string') {
      throw new Error('Invalid profile update')
    }
    const profile = updateProfile({
      id: input.id,
      name: input.name,
      picture: input.picture
    })
    broadcastProfiles()
    void event
    return profile
  })

  ipcMain.handle(IpcChannels.ProfilesDelete, async (event, id: string) => {
    if (typeof id !== 'string' || id === DEFAULT_PROFILE_ID) {
      throw new Error('Profile cannot be deleted')
    }
    // Close windows using the profile before clearing its session and files.
    for (const window of allWindows()) {
      if (window.profile === id && !window.window.isDestroyed()) window.window.close()
    }
    await deleteProfile(id)
    setLastProfileId(DEFAULT_PROFILE_ID)
    // A Settings window opened for the deleted profile must not keep reading or
    // writing that profile's stores. Reload it against the default profile
    // before sending the updated registry so its active id is accurate.
    if (settingsTargetProfileId() === id) {
      openSettingsWindow(undefined, DEFAULT_PROFILE_ID)
    }
    broadcastProfiles()
    void event
    return profilesState(DEFAULT_PROFILE_ID)
  })

  ipcMain.handle(IpcChannels.ProfilesOpenWindow, (event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid profile')
    createWindow({ profileId: id })
    setLastProfileId(id)
    void event
  })

  /* ---- chrome overlay -------------------------------------------------- */

  // The chrome view is normally clipped to its strip height; while a dropdown,
  // palette or menu is open it expands over the page so overlays are not cut off.
  ipcMain.handle(IpcChannels.UiOpenDownloads, (event) =>
    context.getWindow(event as any)?.sendToChrome(IpcChannels.UiOpenDownloads)
  )
  ipcMain.handle(IpcChannels.UiSetOverlayOpen, (event, open: boolean) =>
    context.getWindow(event as any)?.setOverlayOpen(open)
  )
  ipcMain.handle(IpcChannels.UiSetRailExpanded, (event, expanded: boolean) =>
    context.getWindow(event as any)?.setRailExpanded(expanded)
  )
}
