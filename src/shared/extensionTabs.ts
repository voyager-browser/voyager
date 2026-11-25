/** Chrome-compatible tab details produced from Voyager's browser state. */
export interface ExtensionTab {
  id: number
  index: number
  windowId: number
  active: boolean
  pinned: boolean
  muted: boolean
  highlighted: boolean
  selected: boolean
  discarded: boolean
  status: 'loading' | 'complete'
  url?: string
  title?: string
  favIconUrl?: string
}

/** The query filters Voyager can answer from its tab snapshot. */
export interface ExtensionTabsQueryInfo {
  active?: boolean | boolean[]
  pinned?: boolean | boolean[]
  muted?: boolean | boolean[]
  highlighted?: boolean | boolean[]
  selected?: boolean | boolean[]
  discarded?: boolean | boolean[]
  status?: string | string[]
  windowId?: number
  currentWindow?: boolean
  index?: number
  url?: string | string[]
  title?: string | string[]
}

/** Tab properties that map directly onto Voyager's tab actions. */
export interface ExtensionTabsUpdateProperties {
  active?: boolean
  pinned?: boolean
  muted?: boolean
  highlighted?: boolean
  selected?: boolean
}

/** Only same-window index moves are supported by Voyager's tab reorder. */
export interface ExtensionTabsMoveProperties {
  index?: number
  windowId?: number
}

/** One generic request from an extension's `chrome.tabs` shim. */
export interface ExtensionTabsCall {
  operation:
    | 'query'
    | 'get'
    | 'getCurrent'
    | 'getSelected'
    | 'getAllInWindow'
    | 'remove'
    | 'update'
    | 'move'
    | 'duplicate'
    | 'reload'
    | 'goBack'
    | 'goForward'
    | 'getZoom'
    | 'setZoom'
    | 'select'
    | 'highlight'
  tabId?: number
  zoom?: number
  tabIds?: number[]
  windowId?: number
  queryInfo?: ExtensionTabsQueryInfo
  updateProperties?: ExtensionTabsUpdateProperties
  moveProperties?: ExtensionTabsMoveProperties
}
