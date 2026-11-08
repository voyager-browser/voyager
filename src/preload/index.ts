import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ALL_IPC_CHANNELS, IpcChannels, type IpcChannel } from '../shared/ipc-channels'
import type {
  AppVersionInfo,
  BookmarkFolderPatch,
  BookmarkMoveInput,
  BookmarkNodeKind,
  BookmarkPatch,
  BookmarksState,
  BrowserState,
  CertificateDetails,
  CertificateExportFormat,
  ClearBrowsingDataOptions,
  DownloadsState,
  HistoryState,
  NewBookmarkFolderInput,
  NewBookmarkInput,
  NewTabRequest,
  PermissionKind,
  PermissionPromptCancelled,
  PermissionPromptRequest,
  PermissionRequestChoice,
  PromptRequest,
  SettingsTarget,
  SitePermissionsState,
  ThemeMode,
  ThemeState,
  Unsubscribe,
  UserPreferences,
  WindowState
} from '../shared/types'
import type {
  CreateProfileInput,
  ProfileInfo,
  ProfilesState,
  RenameProfileInput
} from '../shared/profiles'

const allowedChannels = new Set<string>(ALL_IPC_CHANNELS)

function subscribe<TPayload>(
  channel: IpcChannel,
  listener: (payload: TPayload) => void
): Unsubscribe {
  if (!allowedChannels.has(channel)) {
    throw new Error(`Unauthorized IPC channel: ${channel}`)
  }
  const wrapped = (_event: IpcRendererEvent, payload: TPayload): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api = {
  /** Platform the app runs on, used to resolve shortcut modifiers. */
  platform: process.platform,

  /** Read-only platform/version info resolved in the main process. */
  appInfo: (): Promise<AppVersionInfo> => ipcRenderer.invoke(IpcChannels.AppGetInfo),

  certificates: {
    get: (url: string): Promise<CertificateDetails | null> =>
      ipcRenderer.invoke(IpcChannels.CertificateGet, url),
    export: (url: string, format: CertificateExportFormat): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.CertificateExport, url, format)
  },

  defaultBrowser: {
    isDefault: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.DefaultBrowserGet),
    setDefault: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.DefaultBrowserSet)
  },

  settings: {
    get: (): Promise<UserPreferences> => ipcRenderer.invoke(IpcChannels.SettingsGet),
    open: (target?: SettingsTarget): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SettingsOpen, target),
    set: (
      key: keyof UserPreferences,
      value: boolean | string | string[]
    ): Promise<UserPreferences> => ipcRenderer.invoke(IpcChannels.SettingsSet, key, value),
    importFilterFile: (name: string, content: string): Promise<UserPreferences> =>
      ipcRenderer.invoke(IpcChannels.ContentBlockingImportFile, { name, content }),
    removeFilterFile: (id: string): Promise<UserPreferences> =>
      ipcRenderer.invoke(IpcChannels.ContentBlockingRemoveFile, id),
    onChanged: (listener: (preferences: UserPreferences) => void): Unsubscribe =>
      subscribe(IpcChannels.SettingsChanged, listener)
  },

  browsingData: {
    clear: (options: ClearBrowsingDataOptions): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BrowsingDataClear, options)
  },

  theme: {
    get: (): Promise<ThemeState> => ipcRenderer.invoke(IpcChannels.ThemeGet),
    set: (mode: ThemeMode): Promise<ThemeState> => ipcRenderer.invoke(IpcChannels.ThemeSet, mode),
    onChanged: (listener: (state: ThemeState) => void): Unsubscribe =>
      subscribe<ThemeState>(IpcChannels.ThemeChanged, listener)
  },

  tabs: {
    getState: (): Promise<BrowserState> => ipcRenderer.invoke(IpcChannels.TabsGetState),
    create: (request?: NewTabRequest): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.TabsCreate, request),
    close: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsClose, id),
    activate: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsActivate, id),
    reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsReorder, ids),
    pinToggle: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsPinToggle, id),
    duplicate: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsDuplicate, id),
    muteToggle: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsMuteToggle, id),
    closeOthers: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsCloseOthers, id),
    closeToRight: (id: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TabsCloseToRight, id),
    copyUrl: (id: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannels.TabsCopyUrl, id),
    reopenLastClosed: (): Promise<void> => ipcRenderer.invoke(IpcChannels.TabsReopenLastClosed),
    onStateChanged: (listener: (state: BrowserState) => void): Unsubscribe =>
      subscribe<BrowserState>(IpcChannels.TabsStateChanged, listener)
  },

  navigation: {
    back: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavBack),
    forward: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavForward),
    reload: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavReload),
    stop: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavStop),
    go: (url: string): Promise<void> => ipcRenderer.invoke(IpcChannels.NavGo, url),
    forceReload: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavForceReload),
    findInPage: (query: string, forward?: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.NavFindInPage, query, forward),
    stopFindInPage: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavStopFindInPage),
    zoomIn: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavZoomIn),
    zoomOut: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavZoomOut),
    zoomReset: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavZoomReset),
    print: (): Promise<void> => ipcRenderer.invoke(IpcChannels.NavPrint),
    printToPdf: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.NavPrintToPdf),
    toggleDevTools: (): Promise<void> => ipcRenderer.invoke(IpcChannels.DevToolsToggle)
  },

  bookmarks: {
    getState: (): Promise<BookmarksState> => ipcRenderer.invoke(IpcChannels.BookmarksGetState),
    add: (input: NewBookmarkInput): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksAdd, input),
    remove: (id: string): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksRemove, id),
    update: (id: string, patch: BookmarkPatch): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksUpdate, id, patch),
    addFolder: (input: NewBookmarkFolderInput): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksAddFolder, input),
    updateFolder: (id: string, patch: BookmarkFolderPatch): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksUpdateFolder, id, patch),
    removeFolder: (id: string): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksRemoveFolder, id),
    move: (input: BookmarkMoveInput): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksMove, input),
    cut: (kind: BookmarkNodeKind, id: string): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksCut, kind, id),
    copy: (kind: BookmarkNodeKind, id: string): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksCopy, kind, id),
    paste: (parentId: string | null): Promise<BookmarksState> =>
      ipcRenderer.invoke(IpcChannels.BookmarksPaste, parentId),
    consumeDragUrl: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.BookmarksConsumeDragUrl),
    openInNewWindow: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BookmarksOpenWindow, url),
    openInIncognitoWindow: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BookmarksOpenIncognitoWindow, url),
    toggleBar: (): Promise<BookmarksState> => ipcRenderer.invoke(IpcChannels.BookmarksToggleBar),
    clear: (): Promise<BookmarksState> => ipcRenderer.invoke(IpcChannels.BookmarksClear),
    onStateChanged: (listener: (state: BookmarksState) => void): Unsubscribe =>
      subscribe<BookmarksState>(IpcChannels.BookmarksStateChanged, listener)
  },

  permissions: {
    getState: (): Promise<SitePermissionsState> =>
      ipcRenderer.invoke(IpcChannels.PermissionsGetState),
    getForOrigin: (origin: string): Promise<SitePermissionsState> =>
      ipcRenderer.invoke(IpcChannels.PermissionsGetForOrigin, origin),
    remove: (origin: string, kind?: PermissionKind): Promise<SitePermissionsState> =>
      ipcRenderer.invoke(IpcChannels.PermissionsRemove, origin, kind),
    clear: (): Promise<SitePermissionsState> => ipcRenderer.invoke(IpcChannels.PermissionsClear),
    respond: (id: string, choice: PermissionRequestChoice): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.PermissionsRespond, id, choice),
    onRequest: (listener: (request: PermissionPromptRequest) => void): Unsubscribe =>
      subscribe<PermissionPromptRequest>(IpcChannels.PermissionsRequest, listener),
    onRequestCancelled: (listener: (event: PermissionPromptCancelled) => void): Unsubscribe =>
      subscribe<PermissionPromptCancelled>(IpcChannels.PermissionsRequestCancelled, listener),
    onStateChanged: (listener: (state: SitePermissionsState) => void): Unsubscribe =>
      subscribe<SitePermissionsState>(IpcChannels.PermissionsStateChanged, listener)
  },

  windows: {
    open: (url?: string): Promise<void> => ipcRenderer.invoke(IpcChannels.WindowsOpen, url),
    openIncognito: (url?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WindowsOpenIncognito, url),
    getState: (): Promise<WindowState> => ipcRenderer.invoke(IpcChannels.WindowsGetState)
  },

  profiles: {
    getState: (): Promise<ProfilesState> => ipcRenderer.invoke(IpcChannels.ProfilesGetState),
    create: (input: CreateProfileInput): Promise<ProfileInfo> =>
      ipcRenderer.invoke(IpcChannels.ProfilesCreate, input),
    update: (input: RenameProfileInput): Promise<ProfileInfo> =>
      ipcRenderer.invoke(IpcChannels.ProfilesUpdate, input),
    delete: (id: string): Promise<ProfilesState> =>
      ipcRenderer.invoke(IpcChannels.ProfilesDelete, id),
    openWindow: (id: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.ProfilesOpenWindow, id),
    onStateChanged: (listener: (state: ProfilesState) => void): Unsubscribe =>
      subscribe<ProfilesState>(IpcChannels.ProfilesStateChanged, listener)
  },

  history: {
    getState: (): Promise<HistoryState> => ipcRenderer.invoke(IpcChannels.HistoryGetState),
    remove: (id: string): Promise<HistoryState> =>
      ipcRenderer.invoke(IpcChannels.HistoryRemove, id),
    clear: (): Promise<HistoryState> => ipcRenderer.invoke(IpcChannels.HistoryClear),
    recordVisit: (visit: { url: string; title: string }): Promise<HistoryState> =>
      ipcRenderer.invoke(IpcChannels.HistoryRecordVisit, visit),
    onStateChanged: (listener: (state: HistoryState) => void): Unsubscribe =>
      subscribe<HistoryState>(IpcChannels.HistoryStateChanged, listener)
  },

  downloads: {
    getState: (): Promise<DownloadsState> => ipcRenderer.invoke(IpcChannels.DownloadsGetState),
    clear: (): Promise<DownloadsState> => ipcRenderer.invoke(IpcChannels.DownloadsClear),
    pause: (id: string): Promise<DownloadsState> =>
      ipcRenderer.invoke(IpcChannels.DownloadsPause, id),
    resume: (id: string): Promise<DownloadsState> =>
      ipcRenderer.invoke(IpcChannels.DownloadsResume, id),
    cancel: (id: string): Promise<DownloadsState> =>
      ipcRenderer.invoke(IpcChannels.DownloadsCancel, id),
    remove: (id: string): Promise<DownloadsState> =>
      ipcRenderer.invoke(IpcChannels.DownloadsRemove, id),
    copyUrl: (id: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannels.DownloadsCopyUrl, id),
    openFolder: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.DownloadsOpenFolder, id),
    onStateChanged: (listener: (state: DownloadsState) => void): Unsubscribe =>
      subscribe<DownloadsState>(IpcChannels.DownloadsStateChanged, listener)
  },

  ui: {
    onFocusOmnibox: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiFocusOmnibox, listener),
    onFindInPage: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiFindInPage, listener),
    onOpenTabSearch: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiOpenTabSearch, listener),
    onOpenHistory: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiOpenHistory, listener),
    onOpenDownloads: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiOpenDownloads, listener),
    onOpenBookmarksManager: (listener: () => void): Unsubscribe =>
      subscribe<void>(IpcChannels.UiOpenBookmarksManager, listener),
    onPromptRequest: (listener: (request: PromptRequest) => void): Unsubscribe =>
      subscribe<PromptRequest>(IpcChannels.UiPromptRequest, listener),
    respondToPrompt: (id: string, value: string | null): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.PromptRespond, { id, value }),
    setOverlayOpen: (open: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.UiSetOverlayOpen, open),
    setRailExpanded: (expanded: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.UiSetRailExpanded, expanded)
  }
} as const

contextBridge.exposeInMainWorld('voyager', api)

export type VoyagerApi = typeof api
