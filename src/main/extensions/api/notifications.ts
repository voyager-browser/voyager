import { Notification, type NotificationConstructorOptions } from 'electron'
import { broadcastExtensionApiEvent } from './events'
import { hasApiPermission } from './permissions'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

type PermissionLevel = 'granted' | 'denied'

interface NotificationButton {
  title: string
  iconUrl?: string
}

interface NotificationRecord {
  id: string
  title: string
  message: string
  createdAt: number
  iconUrl?: string
  silent?: boolean
  priority?: number
  eventTime?: number
  buttons?: NotificationButton[]
}

interface NativeEntry {
  notification: Notification
  closedByApi: boolean
}

const natives = new Map<string, NativeEntry>()
const levels = new Map<string, PermissionLevel>()
let nextId = 0

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const storageKey = (extensionId: string): string => `notifications:${extensionId}`
const entryKey = (profileId: string, extensionId: string, id: string): string =>
  `${profileId}\u0000${extensionId}\u0000${id}`
const levelKey = (profileId: string, extensionId: string): string =>
  `${profileId}\u0000${extensionId}`

function readStore(profileId: string, extensionId: string): Record<string, NotificationRecord> {
  const stored = getApiSetting<Record<string, NotificationRecord>>(
    profileId,
    storageKey(extensionId),
    {}
  )
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
}

function writeStore(
  profileId: string,
  extensionId: string,
  store: Record<string, NotificationRecord>
): void {
  setApiSetting(profileId, storageKey(extensionId), store)
}

function applyOptions(item: NotificationRecord, options: Record<string, unknown>): void {
  if (typeof options.title === 'string') item.title = options.title
  if (typeof options.message === 'string') item.message = options.message
  else if (typeof options.body === 'string') item.message = options.body
  if (typeof options.iconUrl === 'string') item.iconUrl = options.iconUrl
  if (typeof options.silent === 'boolean') item.silent = options.silent
  if (typeof options.priority === 'number') item.priority = options.priority
  if (typeof options.eventTime === 'number') item.eventTime = options.eventTime

  const values: unknown[] = Array.isArray(options.buttons) ? options.buttons : []
  const buttons = values
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    )
    .map((value) => ({
      title: typeof value.title === 'string' ? value.title : '',
      ...(typeof value.iconUrl === 'string' ? { iconUrl: value.iconUrl } : {})
    }))
  if (buttons.length > 0) item.buttons = buttons
}

function publicNotification(item: NotificationRecord): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    message: item.message,
    createdAt: item.createdAt,
    ...(item.iconUrl === undefined ? {} : { iconUrl: item.iconUrl }),
    ...(item.silent === undefined ? {} : { silent: item.silent }),
    ...(item.priority === undefined ? {} : { priority: item.priority }),
    ...(item.eventTime === undefined ? {} : { eventTime: item.eventTime }),
    ...(item.buttons === undefined
      ? {}
      : { buttons: item.buttons.map((button) => ({ ...button })) })
  }
}

function emit(profileId: string, extensionId: string, event: string, args: unknown[]): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: ['notifications'], event, args, extensionId },
    'notifications'
  )
}

/** Resolve and announce changes in the extension's notification permission. */
function permissionLevel(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>,
  announce: boolean
): PermissionLevel {
  const level: PermissionLevel = hasApiPermission(profileId, extensionId, manifest, 'notifications')
    ? 'granted'
    : 'denied'
  if (announce) {
    const key = levelKey(profileId, extensionId)
    const previous = levels.get(key)
    levels.set(key, level)
    if (previous !== undefined && previous !== level) {
      emit(profileId, extensionId, 'onPermissionLevelChanged', [level])
    }
  }
  return level
}

/** Call when a notifications permission decision changes outside this API. */
export function notifyNotificationPermissionChange(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown> = {}
): void {
  permissionLevel(profileId, extensionId, manifest, true)
}

function nativeOptions(item: NotificationRecord): NotificationConstructorOptions {
  const options: NotificationConstructorOptions = {
    id: item.id,
    title: item.title,
    body: item.message
  }
  if (item.iconUrl) options.icon = item.iconUrl
  if (item.silent !== undefined) options.silent = item.silent
  if (process.platform === 'darwin' && item.buttons && item.buttons.length > 0) {
    options.actions = item.buttons.slice(0, 5).map((button) => ({
      type: 'button' as const,
      text: button.title
    }))
  }
  return options
}

function closeNative(key: string): void {
  const entry = natives.get(key)
  if (!entry) return
  natives.delete(key)
  entry.closedByApi = true
  try {
    entry.notification.close()
  } catch {
    // The notification may already have been dismissed by the system.
  }
}

/** Show the record through Electron when desktop notifications are available. */
function showNative(context: ExtensionApiContext, item: NotificationRecord): void {
  try {
    if (typeof Notification === 'undefined' || !Notification.isSupported()) return
  } catch {
    return
  }

  const key = entryKey(context.profileId, context.extensionId, item.id)
  closeNative(key)
  let notification: Notification
  try {
    notification = new Notification(nativeOptions(item))
  } catch {
    return
  }
  const entry: NativeEntry = { notification, closedByApi: false }
  natives.set(key, entry)

  notification.on('click', () => {
    emit(context.profileId, context.extensionId, 'onClicked', [item.id])
  })
  notification.on('action', (_event, index) => {
    emit(context.profileId, context.extensionId, 'onButtonClicked', [item.id, index])
  })
  notification.on('close', () => {
    if (natives.get(key) === entry) natives.delete(key)
    if (!entry.closedByApi) {
      emit(context.profileId, context.extensionId, 'onClosed', [item.id, true])
    }
  })

  try {
    notification.show()
  } catch {
    if (natives.get(key) === entry) natives.delete(key)
  }
}

export function registerNotifications(): void {
  registerExtensionApiHandler('notifications', {
    permissions: {
      create: ['notifications'],
      update: ['notifications'],
      clear: ['notifications'],
      getAll: ['notifications'],
      getPermissionLevel: []
    },
    invoke(context, method, args): unknown {
      const store = readStore(context.profileId, context.extensionId)
      const save = (): void => writeStore(context.profileId, context.extensionId, store)

      if (method === 'create') {
        const provided = typeof args[0] === 'string' && args[0] ? args[0] : ''
        const options = record(provided ? args[1] : args[0])
        const id = provided || `${Date.now()}-${(nextId += 1)}`
        const item: NotificationRecord = {
          id,
          title: '',
          message: '',
          createdAt: Date.now()
        }
        applyOptions(item, options)
        store[id] = item
        save()
        showNative(context, item)
        return id
      }
      if (method === 'update') {
        const id = String(args[0] ?? '')
        const item = store[id]
        if (!item) return false
        applyOptions(item, record(args[1]))
        save()
        showNative(context, item)
        return true
      }
      if (method === 'clear') {
        const id = String(args[0] ?? '')
        if (!store[id]) return false
        closeNative(entryKey(context.profileId, context.extensionId, id))
        delete store[id]
        save()
        emit(context.profileId, context.extensionId, 'onClosed', [id, false])
        return true
      }
      if (method === 'getAll') {
        return Object.values(store).map(publicNotification)
      }
      if (method === 'getPermissionLevel') {
        return permissionLevel(context.profileId, context.extensionId, context.manifest, true)
      }
      throw new Error(`chrome.notifications.${method} is not supported.`)
    }
  })
}
