/** Chrome-compatible muted metadata exposed on `chrome.tabs.Tab`. */
export interface ExtensionMutedInfo {
  muted: boolean
  reason?: 'user' | 'capture' | 'extension'
  extensionId?: string
}

/** Chrome-compatible tab details produced from Voyager's browser state. */
export interface ExtensionTab {
  id: number
  index: number
  windowId: number
  active: boolean
  pinned: boolean
  muted: boolean
  mutedInfo: ExtensionMutedInfo
  highlighted: boolean
  selected: boolean
  discarded: boolean
  autoDiscardable: boolean
  audible: boolean
  frozen: boolean
  incognito: boolean
  groupId: number
  splitViewId: number
  status: 'unloaded' | 'loading' | 'complete'
  url?: string
  pendingUrl?: string
  title?: string
  favIconUrl?: string
  width?: number
  height?: number
  lastAccessed?: number
  openerTabId?: number
  sessionId?: string
}

/** The query filters Voyager can answer from its tab snapshots. */
export interface ExtensionTabsQueryInfo {
  active?: boolean | boolean[]
  audible?: boolean | boolean[]
  autoDiscardable?: boolean | boolean[]
  currentWindow?: boolean
  discarded?: boolean | boolean[]
  frozen?: boolean | boolean[]
  groupId?: number | number[]
  highlighted?: boolean | boolean[]
  index?: number
  lastFocusedWindow?: boolean
  muted?: boolean | boolean[]
  pinned?: boolean | boolean[]
  selected?: boolean | boolean[]
  splitViewId?: number | number[]
  status?: string | string[]
  title?: string | string[]
  url?: string | string[]
  windowId?: number
  windowType?: string | string[]
}

/** Tab properties that map onto Voyager's tab actions. */
export interface ExtensionTabsUpdateProperties {
  active?: boolean
  autoDiscardable?: boolean
  highlighted?: boolean
  muted?: boolean
  openerTabId?: number
  pinned?: boolean
  selected?: boolean
  url?: string
}

/** Properties accepted by the `chrome.tabs.create` bridge. */
export interface ExtensionTabsCreateProperties {
  active?: boolean
  index?: number
  openerTabId?: number
  pinned?: boolean
  selected?: boolean
  splitWithTabId?: number
  url?: string
  windowId?: number
}

/** Index moves may stay in the current window or target another Voyager window. */
export interface ExtensionTabsMoveProperties {
  index?: number
  windowId?: number
}

/** Chrome's zoom-settings object. */
export interface ExtensionZoomSettings {
  defaultZoomFactor?: number
  mode?: 'automatic' | 'manual' | 'disabled'
  scope?: 'per-origin' | 'per-tab'
}

/** Image options accepted by `captureVisibleTab`. */
export interface ExtensionImageDetails {
  format?: 'jpeg' | 'png'
  quality?: number
}

/** Options accepted by `sendMessage` and `connect`. */
export interface ExtensionTabsMessageOptions {
  documentId?: string
  frameId?: number
  name?: string
}

/** One generic request from an extension's `chrome.tabs` shim. */
export interface ExtensionTabsCall {
  operation:
    | 'captureVisibleTab'
    | 'detectLanguage'
    | 'discard'
    | 'duplicate'
    | 'get'
    | 'getAllInWindow'
    | 'getCurrent'
    | 'getSelected'
    | 'getZoom'
    | 'getZoomSettings'
    | 'goBack'
    | 'goForward'
    | 'group'
    | 'highlight'
    | 'move'
    | 'query'
    | 'reload'
    | 'remove'
    | 'setZoom'
    | 'setZoomSettings'
    | 'ungroup'
    | 'unsplit'
    | 'update'
    | 'createSplit'
    | 'select'
  tabId?: number
  tabIds?: number[]
  windowId?: number
  zoom?: number
  zoomSettings?: ExtensionZoomSettings
  message?: unknown
  messageOptions?: ExtensionTabsMessageOptions
  createProperties?: ExtensionTabsCreateProperties
  imageDetails?: ExtensionImageDetails
  queryInfo?: ExtensionTabsQueryInfo
  updateProperties?: ExtensionTabsUpdateProperties
  moveProperties?: ExtensionTabsMoveProperties
  groupId?: number
  splitViewId?: number
  bypassCache?: boolean
}
