/**
 * Persisted metadata needed to auto-update downloaded extensions. Unpacked
 * folders the user chose themselves are never overwritten, so only CRX and
 * Web Store installs get an update URL recorded here.
 */

import { getSettings, setSettings } from '../store'

const SETTINGS_KEY = 'extensionUpdateInfo'

export interface ExtensionUpdateInfo {
  /** Chrome Web Store id, recorded when Voyager downloaded the CRX. */
  storeId?: string
  /** `update_url` from the CRX manifest, for self-hosted extensions. */
  updateUrl?: string
  /** Version currently installed on disk. */
  version?: string
  /** SHA-256 of the verified CRX3 developer key (SubjectPublicKeyInfo DER). */
  publicKeyHash?: string
  /** Chrome id derived from that key, cross-checked against CRX3 signed data. */
  signingId?: string
  /** Timestamp of the most recent update check. */
  lastCheckedAt?: number
}

type UpdateInfoMap = Record<string, ExtensionUpdateInfo>

function validUpdateInfo(value: unknown): ExtensionUpdateInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const info = value as Record<string, unknown>
  const result: ExtensionUpdateInfo = {}
  if (typeof info.storeId === 'string' && /^[a-p]{32}$/i.test(info.storeId)) {
    result.storeId = info.storeId.toLowerCase()
  }
  if (typeof info.updateUrl === 'string' && info.updateUrl.trim() !== '') {
    result.updateUrl = info.updateUrl.trim()
  }
  if (typeof info.version === 'string' && info.version.trim() !== '') {
    result.version = info.version.trim()
  }
  if (typeof info.publicKeyHash === 'string' && /^[0-9a-f]{64}$/i.test(info.publicKeyHash)) {
    result.publicKeyHash = info.publicKeyHash.toLowerCase()
  }
  if (typeof info.signingId === 'string' && /^[a-p]{32}$/i.test(info.signingId)) {
    result.signingId = info.signingId.toLowerCase()
  }
  if (typeof info.lastCheckedAt === 'number' && Number.isFinite(info.lastCheckedAt)) {
    result.lastCheckedAt = info.lastCheckedAt
  }
  return Object.keys(result).length > 0 ? result : null
}

/** All recorded update metadata, keyed by the extension's stored directory. */
export function extensionUpdateInfoMap(profileId: string): UpdateInfoMap {
  const stored = getSettings<UpdateInfoMap>(profileId, SETTINGS_KEY, {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: UpdateInfoMap = {}
  for (const [path, value] of Object.entries(stored)) {
    const info = validUpdateInfo(value)
    if (info) result[path] = info
  }
  return result
}

/** Metadata for one stored extension path. */
export function updateInfoForPath(profileId: string, path: string): ExtensionUpdateInfo | null {
  return extensionUpdateInfoMap(profileId)[path] ?? null
}

/** Merge metadata into one extension's record without disturbing other keys. */
export function recordExtensionUpdateInfo(
  profileId: string,
  path: string,
  patch: ExtensionUpdateInfo
): void {
  const all = extensionUpdateInfoMap(profileId)
  const merged = { ...(all[path] ?? {}), ...patch }
  const cleaned = validUpdateInfo(merged) ?? {}
  if (Object.keys(cleaned).length === 0) delete all[path]
  else all[path] = cleaned
  setSettings(profileId, SETTINGS_KEY, all)
}

/** Drop metadata when an extension is uninstalled. */
export function forgetExtensionUpdateInfo(profileId: string, path: string): void {
  const all = extensionUpdateInfoMap(profileId)
  if (!(path in all)) return
  delete all[path]
  setSettings(profileId, SETTINGS_KEY, all)
}
