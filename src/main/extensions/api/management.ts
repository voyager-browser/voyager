import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Extension, Session } from 'electron'
import { extensionPermissionLabels } from '../../../shared/permissions'
import type { ExtensionInfo } from '../../../shared/types'
import { sessionForProfile } from '../../profiles/session'
import { allWindows, windowForAnyWebContents } from '../../window/windowRegistry'
import {
  currentExtensionsState,
  extensionOptionsPage,
  extensionResourceUrl,
  installedExtensionPaths,
  uninstallExtension
} from '../extensions'
import { updateInfoForPath } from '../updateMetadata'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { deleteApiSetting, getApiSetting, listApiSettingKeys, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

const PATH = 'management'
const PATH_KEY_PREFIX = 'management:extensionPath:'
const DISABLED_KEY_PREFIX = 'management:disabled:'

const trackedSessions = new WeakSet<Session>()
const pendingEnable = new Set<string>()
const suppressedUnload = new Set<string>()

interface ChromeIconInfo {
  size: number
  url: string
}

/** Chrome's `management.ExtensionInfo`, limited to fields Voyager can back. */
interface ChromeExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  installType: 'development' | 'normal'
  mayDisable: boolean
  permissions: string[]
  hostPermissions: string[]
  optionsUrl: string
  icons: ChromeIconInfo[]
  type: 'extension' | 'theme'
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function pathKey(extensionId: string): string {
  return `${PATH_KEY_PREFIX}${extensionId}`
}

function disabledKey(extensionId: string): string {
  return `${DISABLED_KEY_PREFIX}${extensionId}`
}

function rememberedIds(profileId: string): string[] {
  return listApiSettingKeys(profileId, PATH_KEY_PREFIX)
    .map((key) => key.slice(PATH_KEY_PREFIX.length))
    .filter((id) => id.length > 0)
}

function isDisabled(profileId: string, extensionId: string): boolean {
  return getApiSetting<boolean>(profileId, disabledKey(extensionId), false) === true
}

function clearRemembered(profileId: string, extensionId: string): void {
  deleteApiSetting(profileId, pathKey(extensionId))
  deleteApiSetting(profileId, disabledKey(extensionId))
}

function rememberExtension(profileId: string, extension: Extension): void {
  const stored = getApiSetting<string | null>(profileId, pathKey(extension.id), null)
  if (stored !== extension.path) setApiSetting(profileId, pathKey(extension.id), extension.path)
}

function isInstalledPath(profileId: string, path: string): boolean {
  const target = resolve(path)
  return installedExtensionPaths(profileId).some((stored) => resolve(stored) === target)
}

function readManifest(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'))
    return record(parsed)
  } catch {
    return {}
  }
}

function manifestExists(path: string): boolean {
  return existsSync(join(path, 'manifest.json'))
}

function extensionFor(
  extensionId: string,
  path: string,
  manifest: Record<string, unknown>,
  loaded: Extension | null
): Extension {
  if (loaded) return loaded
  // Disabled extensions are not loaded, so Chromium has no per-load dynamic id.
  // Use the stable extension id; the synthetic object is only used to describe
  // options pages, icons, and manifest metadata.
  return {
    dynamicId: extensionId,
    id: extensionId,
    name: stringValue(manifest.name, extensionId),
    version: stringValue(manifest.version, ''),
    path,
    url: `chrome-extension://${extensionId}/`,
    manifest
  } as Extension
}

function optionsUrlFor(extension: Extension): string {
  const page = extensionOptionsPage(extension)
  if (!page) return ''
  try {
    return extensionResourceUrl(extension, page)
  } catch {
    return ''
  }
}

function iconsFor(extension: Extension): ChromeIconInfo[] {
  const manifest = record(extension.manifest)
  const sources: Record<string, unknown> = { ...record(manifest.icons) }
  const action = record(manifest.action ?? manifest.browser_action ?? manifest.page_action)
  const defaultIcon = action.default_icon
  if (typeof defaultIcon === 'string') sources['128'] = defaultIcon
  else Object.assign(sources, record(defaultIcon))

  const icons: ChromeIconInfo[] = []
  for (const [size, value] of Object.entries(sources)) {
    if (!/^\d+$/.test(size) || typeof value !== 'string') continue
    try {
      icons.push({ size: Number(size), url: extensionResourceUrl(extension, value) })
    } catch {
      // Ignore icons that point outside the extension package.
    }
  }
  return icons.sort((left, right) => left.size - right.size)
}

function isHostPattern(value: string): boolean {
  return value === '<all_urls>' || value.includes('://')
}

function permissionParts(manifest: Record<string, unknown>): {
  permissions: string[]
  hostPermissions: string[]
} {
  const declared = stringList(manifest.permissions)
  const hosts = stringList(manifest.host_permissions)
  return {
    permissions: [...new Set(declared.filter((value) => !isHostPattern(value)))],
    hostPermissions: [...new Set([...hosts, ...declared.filter((value) => isHostPattern(value))])]
  }
}

function warningsForManifest(manifest: Record<string, unknown>): string[] {
  const { permissions, hostPermissions } = permissionParts(manifest)
  const warnings = new Set<string>()
  for (const permission of [...permissions, ...hostPermissions]) {
    for (const warning of extensionPermissionLabels(permission)) warnings.add(warning)
  }
  return [...warnings]
}

function toChromeInfo(
  profileId: string,
  extensionId: string,
  path: string,
  loaded: Extension | null,
  enabled: boolean,
  state?: ExtensionInfo
): ChromeExtensionInfo {
  const manifest = loaded ? record(loaded.manifest) : readManifest(path)
  const extension = extensionFor(extensionId, path, manifest, loaded)
  const { permissions, hostPermissions } = permissionParts(manifest)
  return {
    id: extensionId,
    name: stringValue(state?.name, stringValue(manifest.name, extensionId)),
    version: stringValue(state?.version, stringValue(manifest.version, '')),
    description: stringValue(manifest.description, ''),
    enabled,
    installType: updateInfoForPath(profileId, path)?.storeId ? 'normal' : 'development',
    mayDisable: true,
    permissions,
    hostPermissions,
    optionsUrl: optionsUrlFor(extension),
    icons: iconsFor(extension),
    type: manifest.theme !== undefined ? 'theme' : 'extension'
  }
}

function allChromeInfos(profileId: string): ChromeExtensionInfo[] {
  const ses = sessionForProfile(profileId)
  const states = currentExtensionsState(ses, profileId)
  const infos = new Map<string, ChromeExtensionInfo>()

  for (const state of states) {
    if (!state.id) continue
    const extension = ses.extensions.getExtension(state.id)
    if (!extension) continue
    rememberExtension(profileId, extension)
    infos.set(
      state.id,
      toChromeInfo(
        profileId,
        state.id,
        state.path,
        extension,
        !isDisabled(profileId, state.id),
        state
      )
    )
  }

  // Disabled extensions stay installed on disk but are not loaded in Electron.
  for (const id of rememberedIds(profileId)) {
    if (infos.has(id)) continue
    const path = getApiSetting<string | null>(profileId, pathKey(id), null)
    if (!path || !manifestExists(path)) {
      if (path) clearRemembered(profileId, id)
      continue
    }
    const state = states.find((item) => resolve(item.path) === resolve(path))
    infos.set(id, toChromeInfo(profileId, id, path, null, false, state))
  }

  return [...infos.values()]
}

function infoForId(profileId: string, extensionId: string): ChromeExtensionInfo {
  const info = allChromeInfos(profileId).find((item) => item.id === extensionId)
  if (!info) throw new Error(`No installed extension has id ${extensionId}.`)
  return info
}

function manifestForId(profileId: string, extensionId: string): Record<string, unknown> {
  const loaded = sessionForProfile(profileId).extensions.getExtension(extensionId)
  if (loaded) return record(loaded.manifest)
  const path = getApiSetting<string | null>(profileId, pathKey(extensionId), null)
  return path ? readManifest(path) : {}
}

/**
 * Listen to Electron's real extension lifecycle. `extension-loaded` is only
 * reported as an install when the path is not yet in the app's installed list,
 * and a path disappearing before unload is the uninstall signal.
 */
export function attachManagementEvents(ses: Session, profileId: string): void {
  if (trackedSessions.has(ses)) return
  trackedSessions.add(ses)
  for (const extension of ses.extensions.getAllExtensions()) {
    rememberExtension(profileId, extension)
  }

  ses.extensions.on('extension-loaded', (_event, extension) => {
    rememberExtension(profileId, extension)
    const info = toChromeInfo(profileId, extension.id, extension.path, extension, true)
    if (pendingEnable.delete(extension.id)) {
      broadcastExtensionApiEvent(profileId, { path: [PATH], event: 'onEnabled', args: [info] })
      return
    }
    if (!isInstalledPath(profileId, extension.path)) {
      broadcastExtensionApiEvent(profileId, { path: [PATH], event: 'onInstalled', args: [info] })
    } else if (isDisabled(profileId, extension.id)) {
      deleteApiSetting(profileId, disabledKey(extension.id))
      broadcastExtensionApiEvent(profileId, { path: [PATH], event: 'onEnabled', args: [info] })
    }
  })

  ses.extensions.on('extension-unloaded', (_event, extension) => {
    rememberExtension(profileId, extension)
    if (suppressedUnload.delete(extension.id)) return
    if (isDisabled(profileId, extension.id)) {
      broadcastExtensionApiEvent(profileId, {
        path: [PATH],
        event: 'onDisabled',
        args: [extension.id]
      })
      return
    }
    if (!isInstalledPath(profileId, extension.path)) {
      broadcastExtensionApiEvent(profileId, {
        path: [PATH],
        event: 'onUninstalled',
        args: [extension.id]
      })
      clearRemembered(profileId, extension.id)
    }
  })
}

/** Apply persisted disable flags after stored extensions have been attached. */
export function applyManagementState(ses: Session, profileId: string): void {
  attachManagementEvents(ses, profileId)
  for (const id of rememberedIds(profileId)) {
    if (!isDisabled(profileId, id)) continue
    const extension = ses.extensions.getAllExtensions().find((item) => item.id === id)
    if (!extension) continue
    suppressedUnload.add(id)
    try {
      ses.extensions.removeExtension(id)
    } catch {
      suppressedUnload.delete(id)
    }
  }
}

async function setEnabled(
  context: ExtensionApiContext,
  extensionId: string,
  enabled: boolean
): Promise<void> {
  const { profileId } = context
  const ses = sessionForProfile(profileId)
  const loaded = ses.extensions.getExtension(extensionId)

  if (enabled) {
    if (loaded) return
    const path = getApiSetting<string | null>(profileId, pathKey(extensionId), null)
    if (!path || !manifestExists(path)) {
      throw new Error(`No disabled extension files are known for ${extensionId}.`)
    }
    pendingEnable.add(extensionId)
    try {
      await ses.extensions.loadExtension(path)
    } catch (error) {
      pendingEnable.delete(extensionId)
      throw error
    }
    return
  }

  if (!loaded) {
    if (isDisabled(profileId, extensionId)) return
    throw new Error(`No loaded extension has id ${extensionId}.`)
  }
  rememberExtension(profileId, loaded)
  setApiSetting(profileId, disabledKey(extensionId), true)
  ses.extensions.removeExtension(extensionId)
}

function uninstallSelf(context: ExtensionApiContext): void {
  const { extensionId, extension, profileId } = context
  const ses = sessionForProfile(profileId)
  const state = currentExtensionsState(ses, profileId).find((item) => item.id === extensionId)
  const path = extension.path || state?.path
  if (!path) throw new Error('The extension has no installed path.')
  uninstallExtension(ses, profileId, path)
  clearRemembered(profileId, extensionId)
}

function launchUrl(context: ExtensionApiContext, args: unknown[]): void {
  if (typeof args[0] !== 'string') throw new Error('A valid URL is required.')
  let url: URL
  try {
    url = new URL(args[0])
  } catch {
    throw new Error('The URL is invalid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('chrome.management.launchUrl only accepts http and https URLs.')
  }

  const sender = context.event && 'sender' in context.event ? context.event.sender : undefined
  const owner = windowForAnyWebContents(sender)
  const target =
    owner && owner.profile === context.profileId && !owner.window.isDestroyed()
      ? owner
      : allWindows().find(
          (window) => window.profile === context.profileId && !window.window.isDestroyed()
        )
  if (!target) throw new Error('No browser window is available for the extension profile.')
  target.tabs.create({ url: url.toString(), active: true })
}

export function registerManagement(): void {
  registerExtensionApiHandler(PATH, {
    permissions: {
      setEnabled: ['management'],
      uninstallSelf: ['management'],
      launchUrl: ['management']
    },
    async invoke(context, method, args) {
      const ses = sessionForProfile(context.profileId)
      attachManagementEvents(ses, context.profileId)

      switch (method) {
        case 'getSelf':
          return infoForId(context.profileId, context.extensionId)

        case 'getAll':
          return allChromeInfos(context.profileId)

        case 'get': {
          const id = typeof args[0] === 'string' ? args[0] : ''
          return infoForId(context.profileId, id)
        }

        case 'getPermissionWarningsById': {
          const id = typeof args[0] === 'string' ? args[0] : ''
          infoForId(context.profileId, id)
          return warningsForManifest(manifestForId(context.profileId, id))
        }

        case 'getPermissionWarningsByManifest': {
          if (typeof args[0] !== 'string') throw new Error('A manifest JSON string is required.')
          let parsed: unknown
          try {
            parsed = JSON.parse(args[0])
          } catch {
            throw new Error('The extension manifest could not be parsed as JSON.')
          }
          const manifest = record(parsed)
          if (Object.keys(manifest).length === 0) {
            throw new Error('The extension manifest is invalid.')
          }
          return warningsForManifest(manifest)
        }

        case 'setEnabled': {
          const id = typeof args[0] === 'string' ? args[0] : ''
          const enabled = args[1] === true
          await setEnabled(context, id, enabled)
          return undefined
        }

        case 'uninstallSelf':
          uninstallSelf(context)
          return undefined

        case 'launchUrl':
          launchUrl(context, args)
          return undefined

        default:
          throw new Error(`chrome.${PATH}.${method} is not supported.`)
      }
    }
  })
}
