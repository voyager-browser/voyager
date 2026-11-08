/**
 * Single source of truth for IPC channel names. The chrome preload only
 * exposes these channels to the renderer, so anything not listed here can
 * never cross the bridge.
 */
export const IpcChannels = {
  AppGetInfo: 'app:get-info',
  CertificateGet: 'certificates:get',
  CertificateExport: 'certificates:export',
  DefaultBrowserGet: 'app:default-browser-get',
  DefaultBrowserSet: 'app:default-browser-set',
  SettingsOpen: 'settings:open',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsChanged: 'settings:changed',
  ContentBlockingImportFile: 'content-blocking:import-file',
  ContentBlockingRemoveFile: 'content-blocking:remove-file',

  ProfilesGetState: 'profiles:get-state',
  ProfilesCreate: 'profiles:create',
  ProfilesUpdate: 'profiles:update',
  ProfilesDelete: 'profiles:delete',
  ProfilesOpenWindow: 'profiles:open-window',
  ProfilesStateChanged: 'profiles:state-changed',

  ThemeGet: 'theme:get',
  ThemeSet: 'theme:set',
  ThemeChanged: 'theme:changed',

  TabsGetState: 'tabs:get-state',
  TabsStateChanged: 'tabs:state-changed',
  TabsCreate: 'tabs:create',
  TabsClose: 'tabs:close',
  TabsActivate: 'tabs:activate',
  TabsReorder: 'tabs:reorder',
  TabsPinToggle: 'tabs:pin-toggle',
  TabsDuplicate: 'tabs:duplicate',
  TabsMuteToggle: 'tabs:mute-toggle',
  TabsCloseOthers: 'tabs:close-others',
  TabsCloseToRight: 'tabs:close-to-right',
  TabsCopyUrl: 'tabs:copy-url',

  NavBack: 'nav:back',
  NavForward: 'nav:forward',
  NavReload: 'nav:reload',
  NavStop: 'nav:stop',
  NavGo: 'nav:go',
  NavForceReload: 'nav:force-reload',
  NavFindInPage: 'nav:find-in-page',
  NavStopFindInPage: 'nav:stop-find-in-page',
  NavZoomIn: 'nav:zoom-in',
  NavZoomOut: 'nav:zoom-out',
  NavZoomReset: 'nav:zoom-reset',
  NavPrint: 'nav:print',
  NavPrintToPdf: 'nav:print-to-pdf',
  DevToolsToggle: 'devtools:toggle',

  TabsReopenLastClosed: 'tabs:reopen-last-closed',

  TabGetUserAgent: 'tab:get-user-agent',
  TabDragStart: 'tab:drag-start',
  TabPrompt: 'tab:prompt',

  PromptRespond: 'prompt:respond',
  UiPromptRequest: 'ui:prompt-request',

  BookmarksGetState: 'bookmarks:get-state',
  BookmarksAdd: 'bookmarks:add',
  BookmarksRemove: 'bookmarks:remove',
  BookmarksUpdate: 'bookmarks:update',
  BookmarksAddFolder: 'bookmarks:add-folder',
  BookmarksUpdateFolder: 'bookmarks:update-folder',
  BookmarksRemoveFolder: 'bookmarks:remove-folder',
  BookmarksMove: 'bookmarks:move',
  BookmarksCut: 'bookmarks:cut',
  BookmarksCopy: 'bookmarks:copy',
  BookmarksPaste: 'bookmarks:paste',
  BookmarksConsumeDragUrl: 'bookmarks:consume-drag-url',
  BookmarksOpenWindow: 'bookmarks:open-window',
  BookmarksOpenIncognitoWindow: 'bookmarks:open-incognito-window',
  BookmarksToggleBar: 'bookmarks:toggle-bar',
  BookmarksClear: 'bookmarks:clear',
  BookmarksStateChanged: 'bookmarks:state-changed',

  PermissionsGetState: 'permissions:get-state',
  PermissionsGetForOrigin: 'permissions:get-for-origin',
  PermissionsRemove: 'permissions:remove',
  PermissionsClear: 'permissions:clear',
  PermissionsUndoAutoRemoval: 'permissions:undo-auto-removal',
  PermissionsRespond: 'permissions:respond',
  PermissionsStateChanged: 'permissions:state-changed',
  PermissionsRequest: 'permissions:request',
  PermissionsRequestCancelled: 'permissions:request-cancelled',

  BrowsingDataClear: 'browsing-data:clear',

  DownloadsGetState: 'downloads:get-state',
  DownloadsStateChanged: 'downloads:state-changed',
  DownloadsClear: 'downloads:clear',
  DownloadsPause: 'downloads:pause',
  DownloadsResume: 'downloads:resume',
  DownloadsCancel: 'downloads:cancel',
  DownloadsRemove: 'downloads:remove',
  DownloadsCopyUrl: 'downloads:copy-url',
  DownloadsOpenFolder: 'downloads:open-folder',

  HistoryGetState: 'history:get-state',
  HistoryStateChanged: 'history:state-changed',
  HistoryRecordVisit: 'history:record-visit',
  HistoryRemove: 'history:remove',
  HistoryClear: 'history:clear',

  WindowsOpen: 'windows:open',
  WindowsOpenIncognito: 'windows:open-incognito',
  WindowsGetState: 'windows:get-state',

  UiFocusOmnibox: 'ui:focus-omnibox',
  UiFindInPage: 'ui:find-in-page',
  UiOpenTabSearch: 'ui:open-tab-search',
  UiOpenHistory: 'ui:open-history',
  UiOpenDownloads: 'ui:open-downloads',
  UiOpenBookmarksManager: 'ui:open-bookmarks-manager',
  UiSetOverlayOpen: 'ui:set-overlay-open',
  UiSetRailExpanded: 'ui:set-rail-expanded'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export const ALL_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IpcChannels)
