import type { ExtensionTab } from './extensionTabs'

/** Event names exposed on the `chrome.tabs` shim. */
export type ExtensionTabsEventName =
  | 'onActivated'
  | 'onAttached'
  | 'onCreated'
  | 'onDetached'
  | 'onHighlighted'
  | 'onMoved'
  | 'onRemoved'
  | 'onReplaced'
  | 'onUpdated'
  | 'onZoomChange'

/** Payload sent from the main process to extension pages and service workers. */
export interface ExtensionTabsEventDetails {
  event: ExtensionTabsEventName
  args: unknown[]
}

/** Details carried by `chrome.tabs.onUpdated`. */
export interface ExtensionTabChangeInfo {
  audible?: boolean
  autoDiscardable?: boolean
  discarded?: boolean
  favIconUrl?: string
  frozen?: boolean
  groupId?: number
  mutedInfo?: { muted: boolean; reason?: 'user' | 'capture' | 'extension'; extensionId?: string }
  pinned?: boolean
  splitViewId?: number
  status?: string
  title?: string
  url?: string
}

/** Details carried by `chrome.tabs.onActivated`. */
export interface ExtensionTabActiveInfo {
  tabId: number
  windowId: number
}

/** Details carried by `chrome.tabs.onRemoved`. */
export interface ExtensionTabRemoveInfo {
  windowId: number
  isWindowClosing: boolean
}

/** Details carried by `chrome.tabs.onMoved`. */
export interface ExtensionTabMoveInfo {
  windowId: number
  oldWindowId: number
  index: number
  oldIndex: number
}

/** Details carried by `chrome.tabs.onAttached` and `onDetached`. */
export interface ExtensionTabWindowInfo {
  windowId: number
  position: number
}

/** Details carried by `chrome.tabs.onHighlighted`. */
export interface ExtensionTabHighlightInfo {
  windowId: number
  tabIds: number[]
}

/** Details carried by `chrome.tabs.onZoomChange`. */
export interface ExtensionTabZoomChangeInfo {
  newZoomFactor: number
  oldZoomFactor: number
  tabId: number
  zoomSettings: {
    defaultZoomFactor: number
    mode: 'automatic' | 'manual' | 'disabled'
    scope: 'per-origin' | 'per-tab'
  }
}

/** Details delivered to content-script message listeners. */
export interface ExtensionTabContentMessage {
  event: 'message' | 'connect' | 'port-message' | 'disconnect'
  extensionId: string
  message?: unknown
  name?: string
  portId?: string
  documentId?: string
  frameId?: number
}

/** One port event delivered back to the extension side. */
export interface ExtensionTabPortEvent {
  event: 'message' | 'disconnect'
  portId: string
  message?: unknown
}

export type { ExtensionTab }
