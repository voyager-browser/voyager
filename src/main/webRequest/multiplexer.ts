import type {
  BeforeSendResponse,
  CallbackResponse,
  HeadersReceivedResponse,
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session
} from 'electron'

/**
 * Electron only keeps one webRequest listener per event and session: a later
 * `ses.webRequest.onBeforeRequest(...)` silently replaces an earlier one. The
 * browser needs content blocking, declarativeNetRequest and extension
 * webRequest listeners to coexist, so every feature registers here instead and
 * a single Electron listener dispatches to all of them.
 */
export type WebRequestEvent = 'onBeforeRequest' | 'onBeforeSendHeaders' | 'onHeadersReceived'

type DetailsMap = {
  onBeforeRequest: OnBeforeRequestListenerDetails
  onBeforeSendHeaders: OnBeforeSendHeadersListenerDetails
  onHeadersReceived: OnHeadersReceivedListenerDetails
}

type ResponseMap = {
  onBeforeRequest: CallbackResponse
  onBeforeSendHeaders: BeforeSendResponse
  onHeadersReceived: HeadersReceivedResponse
}

type Handler<K extends WebRequestEvent> = (
  details: DetailsMap[K],
  callback: (response: ResponseMap[K]) => void
) => void

interface SessionHandlers {
  onBeforeRequest: Array<Handler<'onBeforeRequest'>>
  onBeforeSendHeaders: Array<Handler<'onBeforeSendHeaders'>>
  onHeadersReceived: Array<Handler<'onHeadersReceived'>>
}

interface SessionState {
  handlers: SessionHandlers
  installed: Record<WebRequestEvent, boolean>
}

const REQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'] }
const states = new WeakMap<Session, SessionState>()

function stateFor(ses: Session): SessionState {
  let state = states.get(ses)
  if (!state) {
    state = {
      handlers: {
        onBeforeRequest: [],
        onBeforeSendHeaders: [],
        onHeadersReceived: []
      },
      installed: {
        onBeforeRequest: false,
        onBeforeSendHeaders: false,
        onHeadersReceived: false
      }
    }
    states.set(ses, state)
  }
  return state
}

/** Invoke a handler once, treating a throw or empty callback as a pass-through. */
function invoke<K extends WebRequestEvent>(
  handler: Handler<K>,
  details: DetailsMap[K]
): Promise<ResponseMap[K]> {
  return new Promise((resolve) => {
    let settled = false
    const done = (response: ResponseMap[K]): void => {
      if (settled) return
      settled = true
      resolve(response ?? ({} as ResponseMap[K]))
    }
    try {
      handler(details, done)
    } catch {
      done({} as ResponseMap[K])
    }
  })
}

function mergeBeforeRequest(responses: CallbackResponse[]): CallbackResponse {
  if (responses.some((response) => response.cancel === true)) return { cancel: true }
  const redirect = responses.find(
    (response) => typeof response.redirectURL === 'string' && response.redirectURL.length > 0
  )?.redirectURL
  return redirect ? { redirectURL: redirect } : { cancel: false }
}

type MutableHeaders = Record<string, string | string[]>

function mergeBeforeSendHeaders(
  details: OnBeforeSendHeadersListenerDetails,
  responses: BeforeSendResponse[]
): BeforeSendResponse {
  if (responses.some((response) => response.cancel === true)) return { cancel: true }
  const headers: MutableHeaders = { ...details.requestHeaders }
  for (const response of responses) {
    if (response.requestHeaders) Object.assign(headers, response.requestHeaders)
  }
  return Object.keys(headers).length > 0 ? { requestHeaders: headers } : {}
}

function mergeHeadersReceived(
  details: OnHeadersReceivedListenerDetails,
  responses: HeadersReceivedResponse[]
): HeadersReceivedResponse {
  if (responses.some((response) => response.cancel === true)) return { cancel: true }
  const headers: MutableHeaders = { ...(details.responseHeaders ?? {}) }
  for (const response of responses) {
    if (response.responseHeaders) Object.assign(headers, response.responseHeaders)
  }
  const statusLine =
    responses.find((response) => typeof response.statusLine === 'string')?.statusLine ??
    details.statusLine
  return { responseHeaders: headers, statusLine }
}

function install(ses: Session, state: SessionState): void {
  if (!state.installed.onBeforeRequest) {
    state.installed.onBeforeRequest = true
    ses.webRequest.onBeforeRequest(REQUEST_FILTER, (details, callback) => {
      void Promise.all(state.handlers.onBeforeRequest.map((handler) => invoke(handler, details)))
        .then(mergeBeforeRequest)
        .then(callback)
    })
  }

  if (!state.installed.onBeforeSendHeaders) {
    state.installed.onBeforeSendHeaders = true
    ses.webRequest.onBeforeSendHeaders(REQUEST_FILTER, (details, callback) => {
      void Promise.all(
        state.handlers.onBeforeSendHeaders.map((handler) => invoke(handler, details))
      )
        .then((responses) => mergeBeforeSendHeaders(details, responses))
        .then(callback)
    })
  }

  if (!state.installed.onHeadersReceived) {
    state.installed.onHeadersReceived = true
    ses.webRequest.onHeadersReceived(REQUEST_FILTER, (details, callback) => {
      void Promise.all(state.handlers.onHeadersReceived.map((handler) => invoke(handler, details)))
        .then((responses) => mergeHeadersReceived(details, responses))
        .then(callback)
    })
  }
}

/** Add a session webRequest handler. Handlers run in registration order. */
export function registerWebRequestHandler<K extends WebRequestEvent>(
  ses: Session,
  event: K,
  handler: Handler<K>
): void {
  const state = stateFor(ses)
  ;(state.handlers[event] as unknown as Array<Handler<K>>).push(handler)
  install(ses, state)
}
