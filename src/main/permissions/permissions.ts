import { randomUUID } from 'node:crypto'
import type { Session, WebContents } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { permissionHostForOrigin, permissionOriginForUrl } from '../../shared/permissions'
import type {
  PermissionDecision,
  PermissionKind,
  PermissionPromptRequest,
  PermissionRequestChoice,
  SitePermissionDecision,
  SitePermissionsState
} from '../../shared/types'
import { storesFor } from '../store'

/**
 * Chromium permissions that are safe to grant without asking. Everything else
 * either has a stable user-facing category below or is denied.
 */
const AUTO_ALLOWED_PERMISSIONS = new Set([
  'automatic-fullscreen',
  'background-fetch',
  'background-sync',
  'clipboard-sanitized-write',
  'fullscreen',
  'keyboardLock',
  'persistent-storage',
  'pointerLock',
  'storage-access',
  'top-level-storage-access'
])

const DEVICE_PERMISSIONS = new Set([
  'fileSystem',
  'hid',
  'local-fonts',
  'nfc',
  'serial',
  'smart-card',
  'speaker-selection',
  'usb'
])

interface PermissionDetails {
  isMainFrame?: boolean
  mediaType?: 'video' | 'audio' | 'unknown'
  mediaTypes?: Array<'video' | 'audio'>
  requestingUrl?: string
  securityOrigin?: string
}

export interface PermissionPromptRoute {
  tabId: string | null
  send(channel: string, payload?: unknown): void
}

type PermissionPromptRouter = (webContents: WebContents | null) => PermissionPromptRoute | null

interface PendingPermissionRequest {
  request: PermissionPromptRequest
  callback: (granted: boolean) => void
  webContents: WebContents | null
  origin: string
  kind: PermissionKind
  profileId: string
  onDestroyed?: () => void
}

export interface PermissionResponseResult {
  handled: boolean
  changed: boolean
  profileId?: string
}

const attachedSessions = new WeakSet<Session>()
const pendingRequests = new Map<string, PendingPermissionRequest>()
/** Grants scoped to one tab's WebContents, origin and permission category. */
const tabGrants = new Set<string>()
let resolvePromptRoute: PermissionPromptRouter | null = null

/** Let the IPC layer choose which window receives a permission prompt. */
export function configurePermissionPromptRouter(router: PermissionPromptRouter): void {
  resolvePromptRoute = router
}

function permissionKind(permission: string, details: PermissionDetails): PermissionKind | null {
  switch (permission) {
    case 'geolocation':
    case 'geolocation-approximate':
      return 'geolocation'
    case 'notifications':
      return 'notifications'
    case 'media': {
      const mediaTypes = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : [])
      const video = mediaTypes.includes('video')
      const audio = mediaTypes.includes('audio')
      if (video && audio) return 'camera-microphone'
      if (video) return 'camera'
      if (audio) return 'microphone'
      return 'camera-microphone'
    }
    case 'clipboard-read':
      return 'clipboard-read'
    case 'display-capture':
      return 'display-capture'
    case 'midi':
    case 'midiSysex':
      return 'midi'
    default:
      return DEVICE_PERMISSIONS.has(permission) ? 'device-access' : null
  }
}

function originFromRequest(
  details: PermissionDetails,
  webContents: WebContents | null,
  requestingOrigin?: string
): string | null {
  return (
    permissionOriginForUrl(requestingOrigin) ??
    permissionOriginForUrl(details.securityOrigin) ??
    permissionOriginForUrl(details.requestingUrl) ??
    permissionOriginForUrl(webContents?.getURL())
  )
}

function decisionForOrigin(
  profileId: string,
  origin: string,
  kind: PermissionKind
): PermissionDecision | undefined {
  const decisions = storesFor(profileId).permissions.get('decisions')
  const find = (candidate: PermissionKind): SitePermissionDecision | undefined =>
    decisions.find((decision) => decision.origin === origin && decision.kind === candidate)

  const exact = find(kind)
  if (exact) return exact.decision

  if (kind === 'camera' || kind === 'microphone') {
    return find('camera-microphone')?.decision
  }

  if (kind === 'camera-microphone') {
    const camera = find('camera')
    const microphone = find('microphone')
    if (camera?.decision === 'block' || microphone?.decision === 'block') return 'block'
    if (camera?.decision === 'allow' && microphone?.decision === 'allow') return 'allow'
  }

  return undefined
}

function tabGrantKey(webContentsId: number, origin: string, kind: PermissionKind): string {
  return `${webContentsId}\n${origin}\n${kind}`
}

function hasTabGrant(
  webContents: WebContents | null,
  origin: string,
  kind: PermissionKind
): boolean {
  if (!webContents || webContents.isDestroyed()) return false
  if (tabGrants.has(tabGrantKey(webContents.id, origin, kind))) return true
  if (
    (kind === 'camera' || kind === 'microphone') &&
    tabGrants.has(tabGrantKey(webContents.id, origin, 'camera-microphone'))
  ) {
    return true
  }
  if (kind === 'camera-microphone') {
    return (
      tabGrants.has(tabGrantKey(webContents.id, origin, 'camera')) &&
      tabGrants.has(tabGrantKey(webContents.id, origin, 'microphone'))
    )
  }
  return false
}

function upsertDecision(
  profileId: string,
  origin: string,
  kind: PermissionKind,
  decision: PermissionDecision
): boolean {
  const store = storesFor(profileId).permissions
  const current = store.get('decisions')
  const existing = current.find((item) => item.origin === origin && item.kind === kind)
  if (existing?.decision === decision) return false

  const next = current.filter((item) => !(item.origin === origin && item.kind === kind))
  next.push({ origin, kind, decision, updatedAt: Date.now() })
  store.set('decisions', next)
  return true
}

export function currentSitePermissions(profileId: string): SitePermissionsState {
  return { decisions: [...storesFor(profileId).permissions.get('decisions')] }
}

export function sitePermissionsForOrigin(profileId: string, origin: string): SitePermissionsState {
  const normalized = permissionOriginForUrl(origin) ?? origin
  return {
    decisions: storesFor(profileId)
      .permissions.get('decisions')
      .filter((decision) => decision.origin === normalized)
  }
}

/** Remove one site's decision, an entire site, or every saved decision. */
export function removeSitePermissions(
  profileId: string,
  origin?: string,
  kind?: PermissionKind
): boolean {
  const store = storesFor(profileId).permissions
  const current = store.get('decisions')
  const normalized = origin === undefined ? undefined : (permissionOriginForUrl(origin) ?? origin)
  const next = current.filter((decision) => {
    const originMatches = normalized === undefined || decision.origin === normalized
    const kindMatches = kind === undefined || decision.kind === kind
    return !(originMatches && kindMatches)
  })
  if (next.length === current.length) return false
  store.set('decisions', next)
  return true
}

export function clearSitePermissions(profileId: string): boolean {
  const store = storesFor(profileId).permissions
  if (store.get('decisions').length === 0) return false
  store.set('decisions', [])
  return true
}

function cleanupPendingRequest(entry: PendingPermissionRequest): void {
  if (entry.webContents && entry.onDestroyed) {
    entry.webContents.removeListener('destroyed', entry.onDestroyed)
  }
}

export function respondToPermissionRequest(
  id: string,
  choice: PermissionRequestChoice
): PermissionResponseResult {
  const entry = pendingRequests.get(id)
  if (!entry) return { handled: false, changed: false }

  pendingRequests.delete(id)
  cleanupPendingRequest(entry)

  let granted = false
  let changed = false

  switch (choice) {
    case 'allow-site':
      changed = upsertDecision(entry.profileId, entry.origin, entry.kind, 'allow')
      granted = true
      break
    case 'allow-once':
      if (entry.webContents && !entry.webContents.isDestroyed()) {
        tabGrants.add(tabGrantKey(entry.webContents.id, entry.origin, entry.kind))
      }
      granted = true
      break
    case 'block':
      changed = upsertDecision(entry.profileId, entry.origin, entry.kind, 'block')
      granted = false
      break
    case 'dismiss':
      granted = false
      break
  }

  entry.callback(granted)
  return { handled: true, changed, profileId: entry.profileId }
}

/**
 * Attach browser-level permission handling to a session. Persistent decisions
 * are stored by origin + category; "allow once" grants are scoped to one tab.
 */
export function attachPermissionHandlers(ses: Session, profileId: string): void {
  if (attachedSessions.has(ses)) return
  attachedSessions.add(ses)

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) return true

    const kind = permissionKind(permission, details)
    if (!kind) return false

    const origin = originFromRequest(details, webContents, requestingOrigin)
    if (!origin) return false

    const decision = decisionForOrigin(profileId, origin, kind)
    if (decision) return decision === 'allow'
    return hasTabGrant(webContents, origin, kind)
  })

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) {
      callback(true)
      return
    }

    const kind = permissionKind(permission, details)
    const origin = originFromRequest(details, webContents)
    if (!kind || !origin) {
      callback(false)
      return
    }

    const decision = decisionForOrigin(profileId, origin, kind)
    if (decision) {
      callback(decision === 'allow')
      return
    }
    if (hasTabGrant(webContents, origin, kind)) {
      callback(true)
      return
    }

    const route = resolvePromptRoute?.(webContents)
    if (!route) {
      callback(false)
      return
    }

    const id = randomUUID()
    const request: PermissionPromptRequest = {
      id,
      origin,
      host: permissionHostForOrigin(origin),
      kind,
      tabId: route.tabId
    }
    const onDestroyed = (): void => {
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      pending.callback(false)
      route.send(IpcChannels.PermissionsRequestCancelled, { id })
    }
    const entry: PendingPermissionRequest = {
      request,
      callback,
      webContents,
      origin,
      kind,
      profileId,
      onDestroyed
    }
    pendingRequests.set(id, entry)
    webContents.once('destroyed', onDestroyed)
    route.send(IpcChannels.PermissionsRequest, request)
  })
}
