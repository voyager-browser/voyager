import { randomUUID } from 'node:crypto'
import {
  app,
  type BeforeSendResponse,
  type CallbackResponse,
  type HeadersReceivedResponse,
  type Session
} from 'electron'
import { listProfiles } from '../../profiles/profiles'
import { sessionForProfile } from '../../profiles/session'
import { broadcastExtensionApiEvent, isExtensionApiShuttingDown } from './events'
import { hasApiPermission } from './permissions'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, listApiSettingKeys, setApiSetting } from './storage'
import { registerWebRequestHandler } from '../../webRequest/multiplexer'
import type { ExtensionApiContext, ExtensionApiHandlerSpec } from './types'

type WebRequestEventName =
  | 'onBeforeRequest'
  | 'onBeforeSendHeaders'
  | 'onSendHeaders'
  | 'onHeadersReceived'
  | 'onCompleted'
  | 'onErrorOccurred'

type BlockingEventName = 'onBeforeRequest' | 'onBeforeSendHeaders' | 'onHeadersReceived'

interface FilterSpec {
  urls: string[]
  types: string[]
}

interface ListenerRecord {
  id: string
  extensionId: string
  event: WebRequestEventName
  filter: FilterSpec
  blocking: boolean
}

interface RequestInfo {
  id: number
  url: string
  method: string
  resourceType: string
  webContentsId?: number
  initiatorOrigin?: string
  timestamp: number
}

interface PendingDecision {
  key: string
  profileId: string
  requestId: string
  event: BlockingEventName
  owners: Set<string>
  resolve: (response: Record<string, unknown> | undefined) => void
  settled: boolean
  timer?: NodeJS.Timeout
}

const EVENTS: WebRequestEventName[] = [
  'onBeforeRequest',
  'onBeforeSendHeaders',
  'onSendHeaders',
  'onHeadersReceived',
  'onCompleted',
  'onErrorOccurred'
]
const BLOCKING_EVENTS: BlockingEventName[] = [
  'onBeforeRequest',
  'onBeforeSendHeaders',
  'onHeadersReceived'
]
const LISTENER_KEY_PREFIX = 'webRequest:listeners:'
const REQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'] }
const DECISION_TIMEOUT_MS = 40
const WEB_REQUEST_PERMISSIONS = ['webRequest'] as const
const BLOCKING_PERMISSIONS = ['webRequest', 'webRequestBlocking'] as const

const attached = new WeakSet<Session>()
const pending = new Map<string, PendingDecision[]>()
let appListenerAttached = false

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const listenerKey = (extensionId: string): string => `${LISTENER_KEY_PREFIX}${extensionId}`
const pendingKey = (profileId: string, requestId: string): string =>
  `${profileId}\u0000${requestId}`

const CHROME_RESOURCE_TYPES: Record<string, string> = {
  main_frame: 'mainFrame',
  sub_frame: 'subFrame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xmlhttprequest: 'xhr',
  ping: 'ping',
  csp_report: 'cspReport',
  media: 'media',
  websocket: 'webSocket',
  other: 'other'
}

const ELECTRON_RESOURCE_TYPES: Record<string, string> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
}

function isBlockingEvent(event: WebRequestEventName): event is BlockingEventName {
  return BLOCKING_EVENTS.includes(event as BlockingEventName)
}

function hasWebRequestPermission(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>,
  blocking: boolean
): boolean {
  const permissions = blocking ? BLOCKING_PERMISSIONS : WEB_REQUEST_PERMISSIONS
  return permissions.some((permission) =>
    hasApiPermission(profileId, extensionId, manifest, permission)
  )
}

function contextPermitted(context: ExtensionApiContext, blocking: boolean): boolean {
  return hasWebRequestPermission(context.profileId, context.extensionId, context.manifest, blocking)
}

function normalizeFilter(value: unknown): FilterSpec {
  const input = record(value)
  const urls = strings(input.urls)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return {
    urls: urls.length > 0 ? urls : ['<all_urls>'],
    types: strings(input.types)
  }
}

function readListeners(profileId: string, extensionId: string): ListenerRecord[] {
  const stored = getApiSetting<unknown>(profileId, listenerKey(extensionId), [])
  if (!Array.isArray(stored)) return []
  return stored.filter(
    (entry): entry is ListenerRecord =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as ListenerRecord).id === 'string' &&
      typeof (entry as ListenerRecord).extensionId === 'string' &&
      EVENTS.includes((entry as ListenerRecord).event)
  )
}

function writeListeners(profileId: string, extensionId: string, listeners: ListenerRecord[]): void {
  setApiSetting(profileId, listenerKey(extensionId), listeners)
}

function allListeners(profileId: string): ListenerRecord[] {
  const listeners: ListenerRecord[] = []
  for (const key of listApiSettingKeys(profileId, LISTENER_KEY_PREFIX)) {
    listeners.push(...readListeners(profileId, key.slice(LISTENER_KEY_PREFIX.length)))
  }
  return listeners
}

function extraInfoSpec(args: unknown[], filterWasObject: boolean): string[] {
  const candidate = filterWasObject ? args[1] : args[2]
  return typeof candidate === 'string' ? [candidate] : strings(candidate)
}

function requestedBlocking(event: WebRequestEventName, args: unknown[]): boolean {
  if (!isBlockingEvent(event)) return false
  const filterWasObject = typeof args[0] !== 'string'
  return extraInfoSpec(args, filterWasObject).includes('blocking')
}

function addListener(
  context: ExtensionApiContext,
  event: WebRequestEventName,
  args: unknown[]
): string {
  const hasId = typeof args[0] === 'string'
  const id = hasId ? (args[0] as string) : `${context.extensionId}:${event}:${randomUUID()}`
  const filter = normalizeFilter(hasId ? args[1] : args[0])
  const blocking = isBlockingEvent(event) && requestedBlocking(event, args)
  const listeners = readListeners(context.profileId, context.extensionId).filter(
    (listener) => listener.id !== id
  )
  listeners.push({
    id,
    extensionId: context.extensionId,
    event,
    filter,
    blocking
  })
  writeListeners(context.profileId, context.extensionId, listeners)
  return id
}

function removeListener(
  context: ExtensionApiContext,
  event: WebRequestEventName,
  args: unknown[]
): boolean {
  const id = typeof args[0] === 'string' ? args[0] : null
  const filter = id === null ? normalizeFilter(args[0]) : null
  const listeners = readListeners(context.profileId, context.extensionId)
  const kept = listeners.filter((listener) => {
    if (id !== null) return listener.id !== id
    return listener.event !== event || JSON.stringify(listener.filter) !== JSON.stringify(filter)
  })
  if (kept.length !== listeners.length) {
    writeListeners(context.profileId, context.extensionId, kept)
  }
  return kept.length !== listeners.length
}

function hasListener(
  context: ExtensionApiContext,
  event: WebRequestEventName,
  args: unknown[]
): boolean {
  const id = typeof args[0] === 'string' ? args[0] : null
  return readListeners(context.profileId, context.extensionId).some(
    (listener) => listener.event === event && (id === null ? true : listener.id === id)
  )
}

function hasListeners(context: ExtensionApiContext, event: WebRequestEventName): boolean {
  return readListeners(context.profileId, context.extensionId).some(
    (listener) => listener.event === event
  )
}

function globMatch(pattern: string, value: string): boolean {
  let p = 0
  let v = 0
  let star = -1
  let resume = 0
  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) {
      p += 1
      v += 1
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p
      resume = v
      p += 1
    } else if (star >= 0) {
      p = star + 1
      resume += 1
      v = resume
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1
  return p === pattern.length
}

function matchesFilter(filter: FilterSpec, info: RequestInfo): boolean {
  if (filter.types.length > 0) {
    const types = filter.types.map((type) => CHROME_RESOURCE_TYPES[type] ?? type)
    if (!types.includes(info.resourceType)) return false
  }
  if (filter.urls.length === 0 || filter.urls.includes('<all_urls>')) return true
  return filter.urls.some((url) => {
    const pattern = url.replace(/^\*\./, '*').replace(/\^/g, '*').replace(/\|$/g, '')
    return globMatch(pattern, info.url)
  })
}

function chromeResourceType(value: string): string {
  return ELECTRON_RESOURCE_TYPES[value] ?? 'other'
}

function requestInfo(
  details: { id: number; url: string; method: string; resourceType: string } & {
    webContentsId?: number
    initiatorOrigin?: string
    timestamp: number
  }
): RequestInfo {
  return {
    id: details.id,
    url: details.url,
    method: details.method,
    resourceType: details.resourceType,
    ...(details.webContentsId === undefined ? {} : { webContentsId: details.webContentsId }),
    ...(details.initiatorOrigin === undefined ? {} : { initiatorOrigin: details.initiatorOrigin }),
    timestamp: details.timestamp
  }
}

function commonDetails(info: RequestInfo): Record<string, unknown> {
  return {
    requestId: String(info.id),
    url: info.url,
    method: info.method,
    tabId: info.webContentsId ?? -1,
    type: chromeResourceType(info.resourceType),
    timeStamp: info.timestamp,
    frameId: 0,
    parentFrameId: -1,
    initiator: info.initiatorOrigin
  }
}

function emit(
  profileId: string,
  event: WebRequestEventName,
  details: Record<string, unknown>
): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: ['webRequest'], event, args: [details] },
    'webRequest'
  )
}

function settleDecision(
  entry: PendingDecision,
  response: Record<string, unknown> | undefined
): void {
  if (entry.settled) return
  entry.settled = true
  if (entry.timer) clearTimeout(entry.timer)
  const list = pending.get(entry.key)
  if (list) {
    const next = list.filter((item) => item !== entry)
    if (next.length > 0) pending.set(entry.key, next)
    else pending.delete(entry.key)
  }
  entry.resolve(response)
}

/** Wait briefly for a registered blocking listener to answer with handlerResult. */
function requestDecision(
  profileId: string,
  requestId: string,
  event: BlockingEventName,
  owners: Set<string>
): Promise<Record<string, unknown> | undefined> {
  if (owners.size === 0) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const key = pendingKey(profileId, requestId)
    const entry: PendingDecision = {
      key,
      profileId,
      requestId,
      event,
      owners,
      resolve,
      settled: false
    }
    entry.timer = setTimeout(() => settleDecision(entry, undefined), DECISION_TIMEOUT_MS)
    const list = pending.get(key) ?? []
    list.push(entry)
    pending.set(key, list)
  })
}

function handleHandlerResult(context: ExtensionApiContext, args: unknown[]): void {
  const response = record(args[0])
  const requestId = typeof response.requestId === 'string' ? response.requestId : null
  const keys = requestId
    ? [pendingKey(context.profileId, requestId)]
    : [...pending.keys()].filter((key) => key.startsWith(`${context.profileId}\u0000`))
  for (const key of keys) {
    for (const entry of [...(pending.get(key) ?? [])]) {
      if (entry.owners.has(context.extensionId)) settleDecision(entry, response)
    }
  }
}

function blockingOwners(
  ses: Session,
  profileId: string,
  event: BlockingEventName,
  info: RequestInfo
): Set<string> {
  const owners = new Set<string>()
  for (const listener of allListeners(profileId)) {
    if (listener.event !== event || !listener.blocking) continue
    if (!matchesFilter(listener.filter, info)) continue
    const extension = ses.extensions
      .getAllExtensions()
      .find((item) => item.id === listener.extensionId)
    if (!extension) continue
    const manifest = (extension.manifest ?? {}) as Record<string, unknown>
    if (!hasWebRequestPermission(profileId, listener.extensionId, manifest, true)) continue
    owners.add(listener.extensionId)
  }
  return owners
}

function safeRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function headerRecord(value: unknown): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [key, headerValue] of Object.entries(record(value))) {
    if (typeof headerValue === 'string') headers[key] = headerValue
    else if (Array.isArray(headerValue)) headers[key] = strings(headerValue)
  }
  return headers
}

function beforeRequestDecision(
  response: Record<string, unknown> | undefined,
  callback: (response: CallbackResponse) => void
): void {
  if (!response) {
    callback({ cancel: false })
    return
  }
  if (response.cancel === true) {
    callback({ cancel: true })
    return
  }
  const redirect = safeRedirectUrl(response.redirectUrl)
  callback(redirect ? { redirectURL: redirect } : { cancel: false })
}

function beforeSendHeadersDecision(
  response: Record<string, unknown> | undefined,
  callback: (response: BeforeSendResponse) => void
): void {
  if (!response) {
    callback({})
    return
  }
  callback({
    cancel: response.cancel === true,
    requestHeaders: headerRecord(response.requestHeaders)
  })
}

function headersReceivedDecision(
  response: Record<string, unknown> | undefined,
  original: Record<string, string[]> | undefined,
  statusLine: string,
  callback: (response: HeadersReceivedResponse) => void
): void {
  if (!response) {
    callback({ responseHeaders: { ...(original ?? {}) }, statusLine })
    return
  }
  callback({
    cancel: response.cancel === true,
    responseHeaders:
      response.responseHeaders === undefined
        ? { ...(original ?? {}) }
        : headerRecord(response.responseHeaders),
    statusLine: typeof response.statusLine === 'string' ? response.statusLine : statusLine
  })
}

function watchNewContents(): void {
  if (appListenerAttached) return
  appListenerAttached = true
  app.on('web-contents-created', (_event, contents) => {
    for (const profile of listProfiles()) {
      const ses = sessionForProfile(profile.id)
      if (contents.session !== ses) continue
      attachWebRequest(ses, profile.id)
      return
    }
  })
}

/** Bridge Electron's webRequest hooks to chrome.webRequest-style events. */
export function attachWebRequest(ses: Session, profileId: string): void {
  if (attached.has(ses)) return
  attached.add(ses)

  registerWebRequestHandler(
    ses,
    'onBeforeRequest',
    (details, callback: (response: CallbackResponse) => void) => {
      if (isExtensionApiShuttingDown()) {
        callback({ cancel: false })
        return
      }
      try {
        const info = requestInfo(details)
        emit(profileId, 'onBeforeRequest', {
          ...commonDetails(info),
          uploadData: details.uploadData
        })
        const owners = blockingOwners(ses, profileId, 'onBeforeRequest', info)
        if (owners.size === 0) {
          callback({ cancel: false })
          return
        }
        void requestDecision(profileId, String(details.id), 'onBeforeRequest', owners).then(
          (response) => beforeRequestDecision(response, callback),
          () => callback({ cancel: false })
        )
      } catch {
        callback({ cancel: false })
      }
    }
  )

  registerWebRequestHandler(
    ses,
    'onBeforeSendHeaders',
    (details, callback: (response: BeforeSendResponse) => void) => {
      if (isExtensionApiShuttingDown()) {
        callback({})
        return
      }
      try {
        const info = requestInfo(details)
        emit(profileId, 'onBeforeSendHeaders', {
          ...commonDetails(info),
          requestHeaders: { ...details.requestHeaders }
        })
        const owners = blockingOwners(ses, profileId, 'onBeforeSendHeaders', info)
        if (owners.size === 0) {
          callback({})
          return
        }
        void requestDecision(profileId, String(details.id), 'onBeforeSendHeaders', owners).then(
          (response) => beforeSendHeadersDecision(response, callback),
          () => callback({})
        )
      } catch {
        callback({})
      }
    }
  )

  ses.webRequest.onSendHeaders(REQUEST_FILTER, (details) => {
    const info = requestInfo(details)
    emit(profileId, 'onSendHeaders', {
      ...commonDetails(info),
      requestHeaders: { ...details.requestHeaders }
    })
  })

  registerWebRequestHandler(
    ses,
    'onHeadersReceived',
    (details, callback: (response: HeadersReceivedResponse) => void) => {
      const passthrough = (): void => {
        callback({
          responseHeaders: { ...(details.responseHeaders ?? {}) },
          statusLine: details.statusLine
        })
      }
      if (isExtensionApiShuttingDown()) {
        passthrough()
        return
      }
      try {
        const info = requestInfo(details)
        emit(profileId, 'onHeadersReceived', {
          ...commonDetails(info),
          statusCode: details.statusCode,
          statusLine: details.statusLine,
          responseHeaders: { ...(details.responseHeaders ?? {}) }
        })
        const owners = blockingOwners(ses, profileId, 'onHeadersReceived', info)
        if (owners.size === 0) {
          passthrough()
          return
        }
        void requestDecision(profileId, String(details.id), 'onHeadersReceived', owners).then(
          (response) =>
            headersReceivedDecision(
              response,
              details.responseHeaders,
              details.statusLine,
              callback
            ),
          passthrough
        )
      } catch {
        passthrough()
      }
    }
  )

  ses.webRequest.onCompleted(REQUEST_FILTER, (details) => {
    const info = requestInfo(details)
    emit(profileId, 'onCompleted', {
      ...commonDetails(info),
      fromCache: details.fromCache,
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      responseHeaders: { ...(details.responseHeaders ?? {}) },
      error: details.error
    })
  })

  ses.webRequest.onErrorOccurred(REQUEST_FILTER, (details) => {
    const info = requestInfo(details)
    emit(profileId, 'onErrorOccurred', {
      ...commonDetails(info),
      fromCache: details.fromCache,
      error: details.error
    })
  })

  watchNewContents()
}

function invokeEvent(
  context: ExtensionApiContext,
  event: WebRequestEventName,
  method: string,
  args: unknown[]
): unknown {
  const blocking = requestedBlocking(event, args)
  if (!contextPermitted(context, blocking)) {
    throw new Error(
      `Missing extension permission: ${blocking ? 'webRequestBlocking' : 'webRequest'}`
    )
  }
  if (method === 'addListener') return addListener(context, event, args)
  if (method === 'removeListener') return removeListener(context, event, args)
  if (method === 'hasListener') return hasListener(context, event, args)
  if (method === 'hasListeners') return hasListeners(context, event)
  throw new Error(`chrome.webRequest.${event}.${method} is not supported.`)
}

function handlerSpec(event?: WebRequestEventName): ExtensionApiHandlerSpec {
  return {
    invoke(context, method, args): unknown {
      attachWebRequest(sessionForProfile(context.profileId), context.profileId)
      if (method === 'handlerBehaviorChanged') {
        // Listener changes are applied immediately; nothing needs flushing.
        return undefined
      }
      if (method === 'handlerResult') {
        if (!contextPermitted(context, true)) {
          throw new Error('Missing extension permission: webRequestBlocking')
        }
        // With no pending blocking request this is intentionally a no-op.
        handleHandlerResult(context, args)
        return undefined
      }
      if (event) return invokeEvent(context, event, method, args)

      const separator = method.indexOf('.')
      if (separator > 0) {
        const candidate = method.slice(0, separator)
        if (EVENTS.includes(candidate as WebRequestEventName)) {
          return invokeEvent(
            context,
            candidate as WebRequestEventName,
            method.slice(separator + 1),
            args
          )
        }
      }
      throw new Error(`chrome.webRequest.${method} is not supported.`)
    }
  }
}

export function registerWebRequest(): void {
  registerExtensionApiHandler('webRequest', handlerSpec())
  for (const event of EVENTS) {
    registerExtensionApiHandler(`webRequest.${event}`, handlerSpec(event))
  }
}
