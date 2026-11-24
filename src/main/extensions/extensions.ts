import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { Extension, Session } from 'electron'
import type {
  ExtensionActionInfo,
  ExtensionHostAccess,
  ExtensionInfo,
  ExtensionSiteAccess
} from '../../shared/types'
import { getSettings, setSettings } from '../store'
import { downloadWebStoreCrx, unpackCrx, unpackedExtensionsRoot, webStoreId } from './crx'
import { removeIllegalExtensionFiles } from './illegalFiles'

const SETTINGS_KEY = 'installedExtensions'
const PINNED_KEY = 'pinnedExtensions'
const SITE_ACCESS_KEY = 'extensionSiteAccess'

function isSamePath(first: string, second: string): boolean {
  return resolve(first) === resolve(second)
}

/** Only scrub Voyager-owned unpack directories, never a user-selected folder. */
function isManagedExtensionPath(path: string, profileId: string): boolean {
  const root = resolve(unpackedExtensionsRoot(profileId))
  const target = resolve(path)
  return target.startsWith(`${root}${sep}`)
}

function readAction(manifest: Record<string, unknown>): ExtensionActionInfo | null {
  const raw = manifest.action ?? manifest.browser_action ?? manifest.page_action
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const action = raw as Record<string, unknown>
  const iconSource = action.default_icon
  let icon: string | null = typeof iconSource === 'string' ? iconSource : null
  if (!icon && iconSource && typeof iconSource === 'object' && !Array.isArray(iconSource)) {
    const sizes = iconSource as Record<string, unknown>
    const key = ['16', '19', '32', '48', '128'].find((size) => typeof sizes[size] === 'string')
    const chosen = key
      ? sizes[key]
      : Object.values(sizes).find((value) => typeof value === 'string')
    if (typeof chosen === 'string') icon = chosen
  }
  return {
    popup: typeof action.default_popup === 'string' ? action.default_popup : null,
    title:
      typeof action.default_title === 'string'
        ? action.default_title
        : String(manifest.name ?? 'Extension'),
    icon,
    iconUrl: null
  }
}

const ICON_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

/**
 * Inline an extension's action icon as a data URL. The chrome renderer is in
 * the browser's session, which may differ from the profile session that owns
 * the extension, so `chrome-extension://` images can fail to load there.
 */
function actionIconDataUrl(extension: Extension, icon: string): string | null {
  if (icon.startsWith('data:image/')) return icon
  const root = resolve(extension.path)
  const candidate = resolve(root, icon.replace(/^\/+/, ''))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  try {
    const stats = statSync(candidate)
    if (!stats.isFile() || stats.size === 0 || stats.size > 512 * 1024) return null
    const mime = ICON_MIME_TYPES[extname(candidate).toLowerCase()]
    if (!mime) return null
    return `data:${mime};base64,${readFileSync(candidate).toString('base64')}`
  } catch {
    return null
  }
}

/** Categorize an extension for the action menu using its manifest permissions. */
export function hostAccessForManifest(manifest: Record<string, unknown>): ExtensionHostAccess {
  const permissions = Array.isArray(manifest.permissions)
    ? (manifest.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
    : []
  const hosts = Array.isArray(manifest.host_permissions)
    ? (manifest.host_permissions as unknown[]).filter(
        (item): item is string => typeof item === 'string'
      )
    : []
  const allUrls = hosts.some((pattern) => /^(<all_urls>|\*:\/\/\*\/?\*?|\*\/\/\*)$/.test(pattern))
  if (allUrls || permissions.includes('<all_urls>')) return 'full'
  const needsAccess =
    hosts.length > 0 || permissions.includes('activeTab') || permissions.includes('tabs')
  return needsAccess ? 'request' : 'none'
}

function pinnedIds(profileId: string): string[] {
  const stored = getSettings<string[]>(profileId, PINNED_KEY, [])
  if (!Array.isArray(stored)) return []
  return stored.filter((id): id is string => typeof id === 'string')
}

/** Toggle an extension's pinned state; returns the new pinned id list. */
export function setExtensionPinned(profileId: string, id: string, pinned: boolean): string[] {
  const next = pinned
    ? [...new Set([...pinnedIds(profileId), id])]
    : pinnedIds(profileId).filter((candidate) => candidate !== id)
  setSettings(profileId, PINNED_KEY, next)
  return next
}

function siteAccessMap(profileId: string): Record<string, ExtensionSiteAccess> {
  const stored = getSettings<Record<string, ExtensionSiteAccess>>(profileId, SITE_ACCESS_KEY, {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: Record<string, ExtensionSiteAccess> = {}
  for (const [id, value] of Object.entries(stored)) {
    if (value === 'click' || value === 'site' || value === 'all') result[id] = value
  }
  return result
}

/** Persist a per-extension site-access choice. */
export function setExtensionSiteAccess(
  profileId: string,
  id: string,
  access: ExtensionSiteAccess
): void {
  setSettings(profileId, SITE_ACCESS_KEY, { ...siteAccessMap(profileId), [id]: access })
}

/** Read and validate the small part of a manifest needed to describe an extension. */
function manifestSummary(path: string): {
  name: string
  version: string
  action: ExtensionActionInfo | null
} {
  const absolute = resolve(path)
  let isDirectory = false
  try {
    isDirectory = statSync(absolute).isDirectory()
  } catch {
    // Missing or unreadable paths are reported by the same error below.
  }
  if (!isDirectory) throw new Error('Choose a folder containing an unpacked extension.')

  const manifestPath = join(absolute, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error('The selected folder does not contain a manifest.json file.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('The extension manifest could not be parsed as JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The extension manifest is invalid.')
  }
  const manifest = parsed as Record<string, unknown>
  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    throw new Error('Only Manifest V2 and V3 extensions are supported.')
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error('The extension manifest has no name.')
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('The extension manifest has no version.')
  }
  return { name: manifest.name, version: manifest.version, action: readAction(manifest) }
}

/** Normalized list of stored extension directories for a profile. */
export function installedExtensionPaths(profileId: string): string[] {
  const stored = getSettings<string[]>(profileId, SETTINGS_KEY, [])
  if (!Array.isArray(stored)) return []
  return [
    ...new Set(stored.filter((item): item is string => typeof item === 'string' && item.length > 0))
  ]
}

function persistPaths(profileId: string, paths: string[]): void {
  setSettings(profileId, SETTINGS_KEY, paths)
}

const pendingAttachments = new WeakMap<Session, Promise<void>>()

async function loadStoredExtensions(ses: Session, profileId: string): Promise<void> {
  const loaded = new Set(
    ses.extensions.getAllExtensions().map((extension) => resolve(extension.path))
  )
  for (const path of installedExtensionPaths(profileId)) {
    if (loaded.has(resolve(path))) continue
    if (isManagedExtensionPath(path, profileId)) removeIllegalExtensionFiles(path)
    try {
      await ses.extensions.loadExtension(path)
    } catch (error) {
      console.warn(`[extensions] Could not load extension at ${path}:`, error)
    }
  }
}

/** Load every stored extension into a profile session once; safe to call repeatedly. */
export function attachExtensions(ses: Session, profileId: string): Promise<void> {
  const pending = pendingAttachments.get(ses)
  if (pending) return pending
  const task = loadStoredExtensions(ses, profileId)
  pendingAttachments.set(ses, task)
  return task
}

/** Loaded extensions plus stored paths that could not be loaded, for settings UI. */
export function currentExtensionsState(ses: Session, profileId: string): ExtensionInfo[] {
  const loaded = new Map<string, Extension>()
  for (const extension of ses.extensions.getAllExtensions()) {
    loaded.set(resolve(extension.path), extension)
  }
  const pinned = pinnedIds(profileId)
  const siteAccess = siteAccessMap(profileId)
  return installedExtensionPaths(profileId).map((path) => {
    const extension = loaded.get(resolve(path))
    if (extension) {
      const manifest = (extension.manifest ?? {}) as Record<string, unknown>
      const action = readAction(manifest)
      const iconUrl = action?.icon ? actionIconDataUrl(extension, action.icon) : null
      return {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        path,
        loaded: true,
        action: action ? { ...action, iconUrl } : null,
        hostAccess: hostAccessForManifest(manifest),
        pinned: extension.id !== null && pinned.includes(extension.id),
        siteAccess:
          extension.id !== null && siteAccess[extension.id] ? siteAccess[extension.id] : 'click'
      }
    }
    try {
      return {
        id: null,
        ...manifestSummary(path),
        path,
        loaded: false,
        hostAccess: 'none' as ExtensionHostAccess,
        pinned: false,
        siteAccess: 'click' as ExtensionSiteAccess
      }
    } catch {
      return {
        id: null,
        name: path,
        version: '',
        path,
        loaded: false,
        action: null,
        hostAccess: 'none' as ExtensionHostAccess,
        pinned: false,
        siteAccess: 'click' as ExtensionSiteAccess
      }
    }
  })
}

/** Accept an unpacked directory or unpack a CRX into the profile's storage. */
function prepareExtensionPath(path: string, profileId: string): string {
  const absolute = resolve(path)
  let stats
  try {
    stats = statSync(absolute)
  } catch {
    throw new Error('Choose an unpacked extension folder or a CRX file.')
  }
  if (stats.isDirectory()) return absolute
  if (stats.isFile() && /\.crx$/i.test(absolute)) return unpackCrx(absolute, profileId)
  throw new Error('Choose an unpacked extension folder or a CRX file.')
}

/** Validate, load, and remember an unpacked extension or CRX for a profile. */
export async function installExtension(
  ses: Session,
  profileId: string,
  path: string
): Promise<ExtensionInfo[]> {
  const absolute = prepareExtensionPath(path, profileId)
  manifestSummary(absolute)
  const paths = installedExtensionPaths(profileId)
  const alreadyLoaded = ses.extensions
    .getAllExtensions()
    .some((extension) => isSamePath(extension.path, absolute))
  if (!alreadyLoaded) await ses.extensions.loadExtension(absolute)
  if (!paths.some((stored) => isSamePath(stored, absolute))) {
    persistPaths(profileId, [...paths, absolute])
  }
  return currentExtensionsState(ses, profileId)
}

/** Download an extension from the Chrome Web Store, unpack it, and load it. */
export async function installExtensionFromStore(
  ses: Session,
  profileId: string,
  input: string
): Promise<ExtensionInfo[]> {
  const id = webStoreId(input)
  const temporaryPath = await downloadWebStoreCrx(id)
  try {
    return await installExtension(ses, profileId, temporaryPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

/** Forget and unload an extension, matched by its stored directory. */
export function uninstallExtension(ses: Session, profileId: string, path: string): ExtensionInfo[] {
  const absolute = resolve(path)
  persistPaths(
    profileId,
    installedExtensionPaths(profileId).filter((stored) => !isSamePath(stored, absolute))
  )
  const extension = ses.extensions
    .getAllExtensions()
    .find((candidate) => isSamePath(candidate.path, absolute))
  if (extension) ses.extensions.removeExtension(extension.id)

  const unpackedRoot = unpackedExtensionsRoot(profileId)
  if (absolute.startsWith(unpackedRoot + sep)) {
    rmSync(absolute, { recursive: true, force: true })
  }
  return currentExtensionsState(ses, profileId)
}

/** Resolve a manifest-relative action resource to its chrome-extension URL. */
export function extensionResourceUrl(extension: Extension, resource: string): string {
  const url = new URL(resource.replace(/^\/+/, ''), extension.url)
  if (url.protocol !== 'chrome-extension:' || url.host !== extension.id) {
    throw new Error('The extension resource is invalid.')
  }
  return url.toString()
}
