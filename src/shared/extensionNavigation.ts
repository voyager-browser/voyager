export type ExtensionWebNavigationEventName =
  | 'onBeforeNavigate'
  | 'onCommitted'
  | 'onDOMContentLoaded'
  | 'onHistoryStateUpdated'
  | 'onCompleted'

/** Minimal `chrome.webNavigation` event details forwarded to extension contexts. */
export interface ExtensionWebNavigationDetails {
  event: ExtensionWebNavigationEventName
  tabId: number
  frameId: number
  url: string
  timeStamp: number
  transitionType: string
}
