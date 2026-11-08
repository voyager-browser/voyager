import { app, clipboard, ipcMain, nativeTheme } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { isPermissionKind, isPermissionRequestChoice } from '../../shared/permissions'
import { DEFAULT_PROFILE_ID, isProfileColor, type CreateProfileInput, type ProfilesState, type RenameProfileInput } from '../../shared/profiles'
import type {
  AppVersionInfo,
  BookmarkFolderPatch,
  BookmarkMoveInput,
  BookmarkNodeKind,
  BookmarkPatch,
  BookmarksState,
  CertificateExportFormat,
  ClearBrowsingDataOptions,
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
  sitePermissionsForOrigin
} from '../permissions/permissions'
import { exportCertificate, getCertificate } from '../certificates/certificates'
import type { WindowController } from '../window/WindowController'
import { openSettingsWindow, settingsProfileFor } from '../window/settingsWindow'
import { activeWindow, allWindows, windowForAnyWebContents, windowForWebContents } from '../window/windowRegistry'
import { consumePendingDragUrl, setPendingDragUrl } from '../bookmarks/drag'
import { isFilterListId } from '../../shared/filter-lists'
import {
  builtinFilterListEnabled,
  enabledCustomFilterFiles,
  enabledCustomFilterLists,
  enabledFilterLists,
  importCustomFilterFile,
  normalizeCustomFilterUrl,
  primeContentBlocking,
  removeCustomFilterFile,
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
import { createWindow } from '../window/createWindow'
import { getSettings, getThemeMode, setSettings, setThemeMode } from '../store'

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
    clearSitePermissions: (getSettings(profileId, 'clearSitePermissions', true) as boolean) !== false,
    openDownloadsWhenDone: getSettings(profileId, 'openDownloadsWhenDone', false) === true,
    searchEngine: (() => {
      const stored = getSettings<SearchEngineId>(profileId, 'searchEngine', DEFAULT_SEARCH_ENGINE)
      return isSearchEngineId(stored) ? stored : DEFAULT_SEARCH_ENGINE
    })(),
    restoreSession: getSettings(profileId, 'restoreSession', false) === true,
    verticalTabs: getSettings(profileId, 'verticalTabs', false) === true,
    contentBlocking: (getSettings(profileId, 'contentBlocking', true) as boolean) !== false,
    builtinFilterList: builtinFilterListEnabled(profileId),
    filterLists: enabledFilterLists(profileId),
    customFilterLists: enabledCustomFilterLists(profileId),
    customFilterFiles: enabledCustomFilterFiles(profileId)
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  // Apply the persisted theme before any renderer starts.
  nativeTheme.themeSource = getThemeMode()

  const profileFor = (event?: SenderEvent): string =>
    context.getWindow(event)?.profile ??
    (event?.sender ? settingsProfileFor(event.sender) : null) ??
    activeWindow()?.profile ??
    DEFAULT_PROFILE_ID

  const sendToProfile = (profileId: string, channel: string, payload?: unknown): void =>
    broadcastToProfile(profileId, channel, payload)

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
    node: process.versions.node ?? ''
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
    'customFilterLists'
  ])

  ipcMain.handle(
    IpcChannels.SettingsSet,
    (_event, key: keyof UserPreferences, value: boolean | string | string[]) => {
      if (!supportedSettings.has(key)) {
        throw new Error(`Unsupported setting: ${key}`)
      }
      const profileId = profileFor(_event as any)
      const respond = (): UserPreferences => {
        const prefs = userPreferences(profileId)
        sendToProfile(profileId, IpcChannels.SettingsChanged, prefs)
        return prefs
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

  /* ---- navigation ------------------------------------------------------ */

  ipcMain.handle(IpcChannels.NavBack, (event) => context.getWindow(event as any)?.tabs.goBack())
  ipcMain.handle(IpcChannels.NavForward, (event) =>
    context.getWindow(event as any)?.tabs.goForward()
  )
  ipcMain.handle(IpcChannels.NavReload, (event) => context.getWindow(event as any)?.tabs.reload())
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

  const broadcastBookmarks = (profileId: string) => (state: BookmarksState): void =>
    sendToProfile(profileId, IpcChannels.BookmarksStateChanged, state)

  ipcMain.handle(IpcChannels.BookmarksGetState, (event) =>
    currentBookmarksState(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.BookmarksAdd, (event, input: NewBookmarkInput) => {
    const profileId = profileFor(event as any)
    return addBookmark(profileId, input, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksRemove, (event, id: string) => {
    const profileId = profileFor(event as any)
    return removeBookmark(profileId, id, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksUpdate, (event, id: string, patch: BookmarkPatch) => {
    const profileId = profileFor(event as any)
    return updateBookmark(profileId, id, patch, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksAddFolder, (event, input: NewBookmarkFolderInput) => {
    const profileId = profileFor(event as any)
    return addFolder(profileId, input, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
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
    }
  )

  ipcMain.handle(IpcChannels.BookmarksUpdateFolder, (event, id: string, patch: BookmarkFolderPatch) => {
    const profileId = profileFor(event as any)
    return updateFolder(profileId, id, patch, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksRemoveFolder, (event, id: string) => {
    const profileId = profileFor(event as any)
    return removeFolder(profileId, id, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksMove, (event, input: BookmarkMoveInput) => {
    const profileId = profileFor(event as any)
    return moveBookmarkNode(profileId, input, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksCopy, (event, kind: BookmarkNodeKind, id: string) => {
    const profileId = profileFor(event as any)
    return copyBookmarkNode(profileId, kind, id, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksCut, (event, kind: BookmarkNodeKind, id: string) => {
    const profileId = profileFor(event as any)
    return cutBookmarkNode(profileId, kind, id, broadcastBookmarks(profileId))
  })

  ipcMain.handle(IpcChannels.BookmarksPaste, (event, parentId: string | null) => {
    const profileId = profileFor(event as any)
    return pasteBookmarkNode(profileId, parentId, broadcastBookmarks(profileId))
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
        color: 'blue',
        createdAt: 0,
        isDefault: true
      }
    }
  })

  ipcMain.handle(IpcChannels.BookmarksClear, (event) => {
    const profileId = profileFor(event as any)
    return clearBookmarks(profileId, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  })

  ipcMain.handle(IpcChannels.BookmarksToggleBar, (event) => {
    const profileId = profileFor(event as any)
    return toggleBookmarksBar(profileId, broadcastBookmarks(profileId), (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  })

  ipcMain.on(IpcChannels.TabDragStart, (event, url: string) => {
    void event
    setPendingDragUrl(url)
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

  ipcMain.handle(
    IpcChannels.HistoryRecordVisit,
    (event, visit: { url: string; title: string }) => {
      const profileId = profileFor(event as any)
      recordVisit(profileId, visit)
      return publishHistory(profileId, (state) =>
        sendToProfile(profileId, IpcChannels.HistoryStateChanged, state)
      )
    }
  )

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

  ipcMain.handle(IpcChannels.ProfilesGetState, (event) =>
    profilesState(profileFor(event as any))
  )

  ipcMain.handle(IpcChannels.ProfilesCreate, (event, input: CreateProfileInput) => {
    if (!input || typeof input.name !== 'string') throw new Error('Profile name is required')
    const profile = createProfile({
      name: input.name,
      color: isProfileColor(input.color) ? input.color : undefined
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
      color: isProfileColor(input.color) ? input.color : undefined
    })
    broadcastProfiles()
    void event
    return profile
  })

  ipcMain.handle(IpcChannels.ProfilesDelete, (event, id: string) => {
    if (typeof id !== 'string' || id === DEFAULT_PROFILE_ID) {
      throw new Error('Profile cannot be deleted')
    }
    // Close windows using the profile before removing its data.
    for (const window of allWindows()) {
      if (window.profile === id && !window.window.isDestroyed()) window.window.close()
    }
    deleteProfile(id)
    setLastProfileId(DEFAULT_PROFILE_ID)
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
