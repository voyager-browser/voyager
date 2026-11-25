import { resolve } from 'node:path'
import type { Session } from 'electron'
import { sessionForProfile } from '../../profiles/session'
import { extensionResourceUrl, installedExtensionPaths } from '../extensions'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

const PATH = 'extension'
const VERSION_KEY_PREFIX = 'extension:version:'
const INCOGNITO_KEY_PREFIX = 'extension:incognitoAccess:'
const FILE_KEY_PREFIX = 'extension:fileSchemeAccess:'

const trackedSessions = new WeakSet<Session>()

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function versionKey(extensionId: string): string {
  return `${VERSION_KEY_PREFIX}${extensionId}`
}

function incognitoKey(extensionId: string): string {
  return `${INCOGNITO_KEY_PREFIX}${extensionId}`
}

function fileSchemeKey(extensionId: string): string {
  return `${FILE_KEY_PREFIX}${extensionId}`
}

function booleanSetting(profileId: string, key: string, fallback: boolean): boolean {
  const value = getApiSetting<unknown>(profileId, key, fallback)
  return typeof value === 'boolean' ? value : fallback
}

function isInstalledPath(profileId: string, path: string): boolean {
  const target = resolve(path)
  return installedExtensionPaths(profileId).some((stored) => resolve(stored) === target)
}

function rememberVersion(profileId: string, extensionId: string, version: string): void {
  if (getApiSetting<string | null>(profileId, versionKey(extensionId), null) === version) return
  setApiSetting(profileId, versionKey(extensionId), version)
}

/**
 * Electron has no main-process extension-to-extension message bus. Duck-type a
 * future native `sendMessage` instead of inventing a fake delivery path.
 */
async function sendExtensionMessage(
  context: ExtensionApiContext,
  args: unknown[]
): Promise<boolean> {
  const first = args[0]
  const targetId = typeof first === 'string' ? first : ''
  const message = typeof first === 'string' ? args[1] : first
  if (!targetId) {
    console.warn('[extension] chrome.extension.sendMessage requires a target extension id.')
    return false
  }

  const ses = sessionForProfile(context.profileId)
  if (!ses.extensions.getExtension(targetId)) {
    console.warn(`[extension] Cannot message extension ${targetId}: it is not loaded.`)
    return false
  }
  const messenger = (
    ses.extensions as unknown as {
      sendMessage?: (extensionId: string, value: unknown) => Promise<unknown>
    }
  ).sendMessage
  if (typeof messenger !== 'function') {
    console.warn(
      '[extension] chrome.extension.sendMessage is not available: Electron exposes no main-process extension messaging API.'
    )
    return false
  }
  try {
    await messenger.call(ses.extensions, targetId, message)
    return true
  } catch (error) {
    console.warn(`[extension] Message to extension ${targetId} failed:`, error)
    return false
  }
}

/**
 * Back the lifecycle events we can observe for real: Electron's extension load
 * and unload hooks, plus version changes detected across reloads. There is no
 * main-process hook for `onStartup`, and the service-worker IPC bridge only
 * forwards registered invoke channels, so runtime message events are left to
 * Electron's native renderer bindings rather than emulated here.
 */
export function attachExtensionLifecycleEvents(ses: Session, profileId: string): void {
  if (trackedSessions.has(ses)) return
  trackedSessions.add(ses)

  // Prime versions already present so a session start is not reported as an update.
  for (const extension of ses.extensions.getAllExtensions()) {
    rememberVersion(profileId, extension.id, extension.version)
  }

  ses.extensions.on('extension-loaded', (_event, extension) => {
    const previous = getApiSetting<string | null>(profileId, versionKey(extension.id), null)
    const alreadyInstalled = isInstalledPath(profileId, extension.path)
    if (!alreadyInstalled) {
      broadcastExtensionApiEvent(profileId, {
        path: [PATH],
        event: 'onInstalled',
        args: [{ id: extension.id, reason: 'install' }],
        extensionId: extension.id
      })
    } else if (previous && previous !== extension.version) {
      broadcastExtensionApiEvent(profileId, {
        path: [PATH],
        event: 'onUpdateAvailable',
        args: [{ version: extension.version }],
        extensionId: extension.id
      })
    }
    rememberVersion(profileId, extension.id, extension.version)
  })

  ses.extensions.on('extension-unloaded', (_event, extension) => {
    broadcastExtensionApiEvent(profileId, {
      path: [PATH],
      event: 'onSuspend',
      args: [],
      extensionId: extension.id
    })
  })
}

export function registerExtension(): void {
  registerExtensionApiHandler(PATH, {
    invoke(context, method, args) {
      const ses = sessionForProfile(context.profileId)
      attachExtensionLifecycleEvents(ses, context.profileId)

      switch (method) {
        case 'getURL':
          return extensionResourceUrl(context.extension, typeof args[0] === 'string' ? args[0] : '')

        case 'getManifest':
          return context.manifest

        case 'getId':
          return context.extensionId

        case 'getExtension': {
          const id = typeof args[0] === 'string' ? args[0] : ''
          const target = id ? ses.extensions.getExtension(id) : null
          if (!target) return null
          return {
            id: target.id,
            name: target.name,
            version: target.version,
            url: target.url,
            manifest: record(target.manifest)
          }
        }

        case 'sendMessage':
          return sendExtensionMessage(context, args)

        case 'isAllowedIncognitoAccess':
          // Incognito partitions do not load extensions; a stored opt-in can
          // still express an explicit user choice when that support arrives.
          return booleanSetting(context.profileId, incognitoKey(context.extensionId), false)

        case 'isAllowedFileSchemeAccess':
          return booleanSetting(context.profileId, fileSchemeKey(context.extensionId), false)

        default:
          throw new Error(`chrome.${PATH}.${method} is not supported.`)
      }
    }
  })
}
