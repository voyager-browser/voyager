import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { ExtensionPermissionChoice, ExtensionPermissionRequest } from '../../shared/types'
import { getSettings, setSettings } from '../store'

const DECISIONS_KEY = 'extensionPermissionDecisions'
const ORIGIN_PREFIX = 'origin:'
/** Required permissions Voyager grants from the manifest without a prompt. */
const AUTO_GRANTED_PERMISSIONS = new Set(['nativeMessaging'])

type Decision = 'allow' | 'block'
type Decisions = Record<string, Record<string, Decision>>

function allDecisions(profileId: string): Decisions {
  const stored = getSettings<Decisions>(profileId, DECISIONS_KEY, {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: Decisions = {}
  for (const [extensionId, values] of Object.entries(stored)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue
    result[extensionId] = {}
    for (const [key, value] of Object.entries(values)) {
      if (value === 'allow' || value === 'block') result[extensionId][key] = value
    }
  }
  return result
}

/** Filter out permissions that already have a persistent user decision. */
export function missingExtensionPermissions(
  profileId: string,
  extensionId: string,
  keys: string[]
): string[] {
  const decided = allDecisions(profileId)[extensionId] ?? {}
  return [...new Set(keys)].filter((key) => key.length > 0 && !decided[key])
}

/** True when every requested permission has an explicit allow decision. */
export function hasAllExtensionPermissions(
  profileId: string,
  extensionId: string,
  keys: string[]
): boolean {
  const decided = allDecisions(profileId)[extensionId] ?? {}
  return keys.every((key) => decided[key] === 'allow')
}

export function recordExtensionPermissionDecision(
  profileId: string,
  extensionId: string,
  keys: string[],
  decision: Decision
): void {
  const decisions = allDecisions(profileId)
  const current = decisions[extensionId] ?? {}
  for (const key of keys) current[key] = decision
  decisions[extensionId] = current
  setSettings(profileId, DECISIONS_KEY, decisions)
}

/**
 * Grant permissions the extension already declares in its manifest and that
 * Voyager supports without user consent. Both MV2 and MV3 use these fields.
 */
export function autoGrantDeclaredPermissions(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>
): string[] {
  const declared = new Set<string>()
  for (const field of ['permissions', 'optional_permissions']) {
    const values = manifest[field]
    if (!Array.isArray(values)) continue
    for (const value of values) {
      if (typeof value === 'string') declared.add(value)
    }
  }
  const granted = [...declared].filter((permission) => AUTO_GRANTED_PERMISSIONS.has(permission))
  if (granted.length === 0) return []
  if (!hasAllExtensionPermissions(profileId, extensionId, granted)) {
    recordExtensionPermissionDecision(profileId, extensionId, granted, 'allow')
  }
  return granted
}

interface PendingRequest {
  id: string
  profileId: string
  extensionId: string
  keys: string[]
  sender: WebContents
  onDestroyed: () => void
  onCancelled?: (id: string) => void
  resolve: (granted: boolean) => void
}

const pending = new Map<string, PendingRequest>()

export interface ExtensionPermissionRequestInput {
  profileId: string
  extensionId: string
  extensionName: string
  keys: string[]
  sender: WebContents
  sendPrompt: (request: ExtensionPermissionRequest) => void
  onCancelled?: (id: string) => void
}

/**
 * Ask the user to grant the extension's requested permissions. The returned
 * promise settles only after the prompt is answered or its sender is closed.
 */
export function requestExtensionPermissions(
  input: ExtensionPermissionRequestInput
): Promise<boolean> {
  const keys = missingExtensionPermissions(input.profileId, input.extensionId, input.keys)
  if (keys.length === 0) {
    return Promise.resolve(
      hasAllExtensionPermissions(input.profileId, input.extensionId, input.keys)
    )
  }

  const id = randomUUID()
  const request: ExtensionPermissionRequest = {
    id,
    extensionId: input.extensionId,
    extensionName: input.extensionName,
    permissions: keys.filter((key) => !key.startsWith(ORIGIN_PREFIX)),
    origins: keys
      .filter((key) => key.startsWith(ORIGIN_PREFIX))
      .map((key) => key.slice(ORIGIN_PREFIX.length))
  }

  return new Promise((resolve) => {
    const entry: PendingRequest = {
      id,
      profileId: input.profileId,
      extensionId: input.extensionId,
      keys,
      sender: input.sender,
      onDestroyed: () => cancelExtensionPermission(id),
      onCancelled: input.onCancelled,
      resolve
    }
    pending.set(id, entry)
    input.sender.once('destroyed', entry.onDestroyed)
    input.sendPrompt(request)
  })
}

export function cancelExtensionPermission(id: string): void {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  if (!entry.sender.isDestroyed()) entry.sender.removeListener('destroyed', entry.onDestroyed)
  entry.onCancelled?.(id)
  entry.resolve(false)
}

export function respondToExtensionPermission(
  id: string,
  choice: ExtensionPermissionChoice
): { handled: boolean; profileId?: string } {
  const entry = pending.get(id)
  if (!entry) return { handled: false }

  pending.delete(id)
  if (!entry.sender.isDestroyed()) entry.sender.removeListener('destroyed', entry.onDestroyed)

  if (choice === 'allow' || choice === 'block') {
    recordExtensionPermissionDecision(entry.profileId, entry.extensionId, entry.keys, choice)
  }
  entry.resolve(choice === 'allow')
  return { handled: true, profileId: choice === 'dismiss' ? undefined : entry.profileId }
}

/** Permissions currently granted to an extension, in Chrome's API shape. */
export function extensionPermissionGrants(
  profileId: string,
  extensionId: string
): { permissions: string[]; origins: string[] } {
  const decisions = allDecisions(profileId)[extensionId] ?? {}
  const granted = Object.entries(decisions)
    .filter(([, decision]) => decision === 'allow')
    .map(([key]) => key)
  return {
    permissions: granted.filter((key) => !key.startsWith(ORIGIN_PREFIX)),
    origins: granted
      .filter((key) => key.startsWith(ORIGIN_PREFIX))
      .map((key) => key.slice(ORIGIN_PREFIX.length))
  }
}

/** Revoke permissions by recording an explicit block decision. */
export function removeExtensionPermissions(
  profileId: string,
  extensionId: string,
  keys: string[]
): void {
  recordExtensionPermissionDecision(profileId, extensionId, keys, 'block')
}

/** Prefix an origin so it is stored distinctly from a named API permission. */
export function extensionOriginKey(origin: string): string {
  return `${ORIGIN_PREFIX}${origin}`
}
