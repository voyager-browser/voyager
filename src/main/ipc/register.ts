import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, session } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { isPermissionKind, isPermissionRequestChoice } from '../../shared/permissions'
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
  ThemeMode,
  ThemeState,
  UserPreferences
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
import { openSettingsWindow } from '../window/settingsWindow'
import { allWindows, windowForAnyWebContents, windowForWebContents } from '../window/windowRegistry'
import { consumePendingDragUrl, setPendingDragUrl } from '../bookmarks/drag'
import { isFilterListId } from '../../shared/filter-lists'
import {
  builtinFilterListEnabled,
  enabledCustomFilterFiles,
  enabledCustomFilterLists,
  enabledFilterLists,
  importCustomFilterFile,
  normalizeCustomFilterUrl,
  removeCustomFilterFile,
  syncContentBlocking
} from '../contentBlocking/contentBlocking'
import { getSettings, setSettings } from '../store'
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
  openWindow?(url?: string): void
  openIncognitoWindow?(url?: string): void
}

function currentThemeState(): ThemeState {
  return {
    mode: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors
  }
}

function applyThemeMode(mode: ThemeMode): ThemeState {
  setSettings('themeMode', mode)
  if (nativeTheme.themeSource !== mode) {
    nativeTheme.themeSource = mode
    // Sites often cache theme-dependent assets such as favicons and media
    // queries, so an explicit mode change refreshes every open page.
    for (const window of allWindows()) window.tabs.reloadAll()
  }
  return currentThemeState()
}

function userPreferences(): UserPreferences {
  return {
    clearHistory: (getSettings('clearHistory', true) as boolean) !== false,
    clearDownloads: (getSettings('clearDownloads', true) as boolean) !== false,
    clearBookmarks: getSettings('clearBookmarks', false) === true,
    clearCookies: (getSettings('clearCookies', true) as boolean) !== false,
    clearLocalStorage: (getSettings('clearLocalStorage', true) as boolean) !== false,
    clearIndexedDb: (getSettings('clearIndexedDb', true) as boolean) !== false,
    clearCache: (getSettings('clearCache', true) as boolean) !== false,
    clearSitePermissions: (getSettings('clearSitePermissions', true) as boolean) !== false,
    openDownloadsWhenDone: getSettings('openDownloadsWhenDone', false) === true,
    searchEngine: (() => {
      const stored = getSettings<SearchEngineId>('searchEngine', DEFAULT_SEARCH_ENGINE)
      return isSearchEngineId(stored) ? stored : DEFAULT_SEARCH_ENGINE
    })(),
    restoreSession: getSettings('restoreSession', false) === true,
    verticalTabs: getSettings('verticalTabs', false) === true,
    contentBlocking: getSettings('contentBlocking', false) !== false,
    builtinFilterList: builtinFilterListEnabled(),
    filterLists: enabledFilterLists(),
    customFilterLists: enabledCustomFilterLists(),
    customFilterFiles: enabledCustomFilterFiles()
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  // Apply the persisted theme before any renderer starts.
  const savedMode = (getSettings('themeMode') as ThemeMode | undefined) ?? 'system'
  nativeTheme.themeSource = savedMode

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
    void event
    return openSettingsWindow(target)
  })

  ipcMain.handle(IpcChannels.SettingsGet, (event) => (void event, userPreferences()))

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
      const respond = (): UserPreferences => {
        const prefs = userPreferences()
        context.send(IpcChannels.SettingsChanged, prefs)
        return prefs
      }
      if (key === 'searchEngine') {
        if (!isSearchEngineId(value)) {
          throw new Error(`Unknown search engine: ${String(value)}`)
        }
        setSettings('searchEngine', value)
        // Open start pages show the active engine; rebuild them in place.
        for (const window of allWindows()) window.tabs.refreshStartPages()
        return respond()
      }
      if (key === 'verticalTabs') {
        const enabled = value === true
        setSettings('verticalTabs', enabled)
        for (const window of allWindows()) window.setVerticalTabs(enabled)
        return respond()
      }
      if (key === 'builtinFilterList') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: builtinFilterList')
        }
        setSettings('builtinFilterList', value)
        syncContentBlocking()
        return respond()
      }
      if (key === 'filterLists') {
        if (
          !Array.isArray(value) ||
          !value.every((id) => typeof id === 'string' && isFilterListId(id))
        ) {
          throw new Error('Expected an array of filter list ids')
        }
        setSettings('filterLists', [...new Set(value)])
        syncContentBlocking()
        return respond()
      }
      if (key === 'customFilterLists') {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          throw new Error('Expected an array of custom filter list URLs')
        }
        const urls = value
          .map((entry) => normalizeCustomFilterUrl(entry))
          .filter((entry): entry is string => entry !== null)
        setSettings('customFilterLists', [...new Set(urls)])
        syncContentBlocking()
        return respond()
      }
      if (key === 'contentBlocking') {
        if (typeof value !== 'boolean') {
          throw new Error('Expected a boolean for setting: contentBlocking')
        }
        setSettings(key, value)
        if (value) syncContentBlocking()
        return respond()
      }
      if (typeof value !== 'boolean') {
        throw new Error(`Expected a boolean for setting: ${key}`)
      }
      setSettings(key, value)
      return respond()
    }
  )

  ipcMain.handle(
    IpcChannels.ContentBlockingImportFile,
    (_event, input: { name?: unknown; content?: unknown }) => {
      const name = typeof input?.name === 'string' ? input.name : 'Custom hosts list'
      const content = typeof input?.content === 'string' ? input.content : ''
      if (!content) throw new Error('No file content was provided.')
      const file = importCustomFilterFile(name, content)
      setSettings('customFilterFiles', [...enabledCustomFilterFiles(), file])
      syncContentBlocking()
      const prefs = userPreferences()
      context.send(IpcChannels.SettingsChanged, prefs)
      return prefs
    }
  )

  ipcMain.handle(IpcChannels.ContentBlockingRemoveFile, (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid filter file id')
    removeCustomFilterFile(id)
    setSettings(
      'customFilterFiles',
      enabledCustomFilterFiles().filter((file) => file.id !== id)
    )
    syncContentBlocking()
    const prefs = userPreferences()
    context.send(IpcChannels.SettingsChanged, prefs)
    return prefs
  })

  /* ---- theme ----------------------------------------------------------- */

  ipcMain.handle(IpcChannels.ThemeGet, (): ThemeState => currentThemeState())

  ipcMain.handle(IpcChannels.ThemeSet, (event, mode: ThemeMode): ThemeState => {
    void event
    const state = applyThemeMode(mode)
    context.send(IpcChannels.ThemeChanged, state)
    return state
  })

  // Push live updates when 'system' changes as the OS theme flips.
  nativeTheme.on('updated', () => {
    context.send(IpcChannels.ThemeChanged, currentThemeState())
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

  const broadcastBookmarks = (state: BookmarksState): void =>
    context.send(IpcChannels.BookmarksStateChanged, state)

  ipcMain.handle(IpcChannels.BookmarksGetState, (event) => (void event, currentBookmarksState()))

  ipcMain.handle(
    IpcChannels.BookmarksAdd,
    (event, input: NewBookmarkInput) => (
      void event,
      addBookmark(input, broadcastBookmarks, (visible) =>
        context.getWindow(event as any)?.setBookmarksBarVisible(visible)
      )
    )
  )

  ipcMain.handle(IpcChannels.BookmarksRemove, (event, id: string) =>
    removeBookmark(id, broadcastBookmarks, (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  )

  ipcMain.handle(IpcChannels.BookmarksUpdate, (event, id: string, patch: BookmarkPatch) => {
    void event
    return updateBookmark(id, patch, broadcastBookmarks)
  })

  ipcMain.handle(IpcChannels.BookmarksAddFolder, (event, input: NewBookmarkFolderInput) =>
    addFolder(input, broadcastBookmarks, (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  )

  /* ---- site permissions ------------------------------------------------ */

  const publishPermissions = (): ReturnType<typeof currentSitePermissions> => {
    const state = currentSitePermissions()
    context.send(IpcChannels.PermissionsStateChanged, state)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.PermissionsStateChanged, state)
    }
    return state
  }

  ipcMain.handle(IpcChannels.PermissionsGetState, (event) => (void event, currentSitePermissions()))

  ipcMain.handle(IpcChannels.PermissionsGetForOrigin, (event, origin: string) => {
    void event
    return typeof origin === 'string' ? sitePermissionsForOrigin(origin) : { decisions: [] }
  })

  ipcMain.handle(IpcChannels.PermissionsRemove, (event, origin: string, kind?: PermissionKind) => {
    void event
    if (typeof origin !== 'string') throw new Error('Invalid permission origin')
    if (kind !== undefined && !isPermissionKind(kind)) {
      throw new Error(`Invalid permission kind: ${String(kind)}`)
    }
    const changed = removeSitePermissions(origin, kind)
    return changed ? publishPermissions() : currentSitePermissions()
  })

  ipcMain.handle(IpcChannels.PermissionsClear, (event) => {
    void event
    const changed = clearSitePermissions()
    return changed ? publishPermissions() : currentSitePermissions()
  })

  ipcMain.handle(
    IpcChannels.PermissionsRespond,
    (_event, id: string, choice: PermissionRequestChoice) => {
      if (typeof id !== 'string' || !isPermissionRequestChoice(choice)) {
        throw new Error('Invalid permission response')
      }
      const result = respondToPermissionRequest(id, choice)
      if (result.changed) publishPermissions()
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

      if (storages.length > 0) {
        await session.defaultSession.clearStorageData({ storages })
      }
      if (options.cache === true) {
        await session.defaultSession.clearCache()
      }
      if (options.sitePermissions === true && clearSitePermissions()) {
        publishPermissions()
      }
    }
  )

  ipcMain.handle(
    IpcChannels.BookmarksUpdateFolder,
    (_event, id: string, patch: BookmarkFolderPatch) => updateFolder(id, patch, broadcastBookmarks)
  )

  ipcMain.handle(IpcChannels.BookmarksRemoveFolder, (event, id: string) =>
    removeFolder(id, broadcastBookmarks, (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  )

  ipcMain.handle(IpcChannels.BookmarksMove, (event, input: BookmarkMoveInput) => {
    void event
    return moveBookmarkNode(input, broadcastBookmarks)
  })

  ipcMain.handle(IpcChannels.BookmarksCopy, (event, kind: BookmarkNodeKind, id: string) => {
    void event
    return copyBookmarkNode(kind, id, broadcastBookmarks)
  })

  ipcMain.handle(IpcChannels.BookmarksCut, (event, kind: BookmarkNodeKind, id: string) => {
    void event
    return cutBookmarkNode(kind, id, broadcastBookmarks)
  })

  ipcMain.handle(IpcChannels.BookmarksPaste, (event, parentId: string | null) => {
    void event
    return pasteBookmarkNode(parentId, broadcastBookmarks)
  })

  ipcMain.handle(
    IpcChannels.BookmarksConsumeDragUrl,
    (event) => (void event, consumePendingDragUrl())
  )

  ipcMain.handle(IpcChannels.BookmarksOpenWindow, (event, url: string) => {
    void event
    context.openWindow?.(url)
  })

  ipcMain.handle(IpcChannels.BookmarksOpenIncognitoWindow, (event, url: string) => {
    void event
    context.openIncognitoWindow?.(url)
  })

  ipcMain.handle(IpcChannels.WindowsOpen, (event, url?: string) => {
    void event
    context.openWindow?.(url)
  })

  ipcMain.handle(IpcChannels.WindowsOpenIncognito, (event, url?: string) => {
    void event
    context.openIncognitoWindow?.(url)
  })

  ipcMain.handle(IpcChannels.WindowsGetState, (event) => ({
    incognito: context.getWindow(event as any)?.isIncognito ?? false
  }))

  ipcMain.handle(IpcChannels.BookmarksClear, (event) =>
    clearBookmarks(broadcastBookmarks, (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  )

  ipcMain.handle(IpcChannels.BookmarksToggleBar, (event) =>
    toggleBookmarksBar(broadcastBookmarks, (visible) =>
      context.getWindow(event as any)?.setBookmarksBarVisible(visible)
    )
  )

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

  ipcMain.handle(IpcChannels.HistoryGetState, (event) => (void event, currentHistoryState()))

  ipcMain.handle(
    IpcChannels.HistoryRecordVisit,
    (_event, visit: { url: string; title: string }) => {
      recordVisit(visit)
      return publishHistory((state) => context.send(IpcChannels.HistoryStateChanged, state))
    }
  )

  ipcMain.handle(IpcChannels.HistoryRemove, (event, id: string) => {
    void event
    removeHistory(id)
    return publishHistory((state) => context.send(IpcChannels.HistoryStateChanged, state))
  })

  ipcMain.handle(IpcChannels.HistoryClear, (event) => {
    void event
    clearHistory()
    return publishHistory((state) => context.send(IpcChannels.HistoryStateChanged, state))
  })

  /* ---- downloads ------------------------------------------------------ */

  ipcMain.handle(IpcChannels.DownloadsGetState, (event) => (void event, currentDownloadsState()))

  ipcMain.handle(IpcChannels.DownloadsClear, (event) => {
    void event
    clearDownloads()
    return publishDownloads((state) => context.send(IpcChannels.DownloadsStateChanged, state))
  })

  const publishDownloadsState = (): ReturnType<typeof publishDownloads> =>
    publishDownloads((state) => context.send(IpcChannels.DownloadsStateChanged, state))

  ipcMain.handle(IpcChannels.DownloadsPause, (event, id: string) => {
    void event
    pauseDownload(id)
    return publishDownloadsState()
  })

  ipcMain.handle(IpcChannels.DownloadsResume, (event, id: string) => {
    void event
    resumeDownload(id)
    return publishDownloadsState()
  })

  ipcMain.handle(IpcChannels.DownloadsCancel, (event, id: string) => {
    void event
    cancelDownload(id)
    return publishDownloadsState()
  })

  ipcMain.handle(IpcChannels.DownloadsRemove, (event, id: string) => {
    void event
    removeDownload(id)
    return publishDownloadsState()
  })

  ipcMain.handle(IpcChannels.DownloadsCopyUrl, (event, id: string) => {
    void event
    const url = downloadUrl(id)
    if (url) clipboard.writeText(url)
    return url
  })

  ipcMain.handle(IpcChannels.DownloadsOpenFolder, (event, id: string) => {
    void event
    return openDownloadFolder(id)
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
