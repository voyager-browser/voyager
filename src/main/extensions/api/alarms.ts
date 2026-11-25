import { listProfiles } from '../../profiles/profiles'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, listApiSettingKeys, setApiSetting } from './storage'

interface AlarmRecord {
  name: string
  scheduledTime: number
  periodInMinutes?: number
  persistAcrossSessions?: boolean
}

const timers = new Map<string, NodeJS.Timeout>()
const storageKey = (extensionId: string): string => `alarms:${extensionId}`
const timerKey = (profileId: string, extensionId: string, name: string): string =>
  `${profileId}\u0000${extensionId}\u0000${name}`

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const readStore = (profileId: string, extensionId: string): Record<string, AlarmRecord> => {
  const stored = getApiSetting<Record<string, AlarmRecord>>(profileId, storageKey(extensionId), {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
}

const saveStore = (
  profileId: string,
  extensionId: string,
  store: Record<string, AlarmRecord>
): void => setApiSetting(profileId, storageKey(extensionId), store)

const publicAlarm = (alarm: AlarmRecord): Record<string, unknown> => ({
  name: alarm.name,
  scheduledTime: alarm.scheduledTime,
  ...(alarm.periodInMinutes === undefined ? {} : { periodInMinutes: alarm.periodInMinutes })
})

function emitAlarm(profileId: string, alarm: AlarmRecord): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: ['alarms'], event: 'onAlarm', args: [publicAlarm(alarm)] },
    'alarms'
  )
}

function schedule(profileId: string, extensionId: string, alarm: AlarmRecord): void {
  const key = timerKey(profileId, extensionId, alarm.name)
  const previous = timers.get(key)
  if (previous) clearTimeout(previous)
  const delay = Math.max(0, Math.min(alarm.scheduledTime - Date.now(), 2_147_483_647))
  const timer = setTimeout(() => {
    timers.delete(key)
    const store = readStore(profileId, extensionId)
    const current = store[alarm.name]
    if (!current) return
    if (typeof current.periodInMinutes === 'number' && current.periodInMinutes > 0) {
      current.scheduledTime = Date.now() + current.periodInMinutes * 60_000
      saveStore(profileId, extensionId, store)
      schedule(profileId, extensionId, current)
    } else {
      delete store[alarm.name]
      saveStore(profileId, extensionId, store)
    }
    emitAlarm(profileId, current)
  }, delay)
  timers.set(key, timer)
}

/** Rehydrate persisted repeating alarms after the app starts. */
export function restoreAlarms(): void {
  for (const profile of listProfiles()) {
    for (const key of listApiSettingKeys(profile.id, 'alarms:')) {
      const extensionId = key.slice('alarms:'.length)
      for (const alarm of Object.values(readStore(profile.id, extensionId))) {
        schedule(profile.id, extensionId, alarm)
      }
    }
  }
}

export function registerAlarms(): void {
  registerExtensionApiHandler('alarms', {
    permissions: ['alarms'],
    invoke(context, method, args): unknown {
      const store = readStore(context.profileId, context.extensionId)
      const save = (): void => saveStore(context.profileId, context.extensionId, store)

      if (method === 'create') {
        const name = typeof args[0] === 'string' ? args[0] : ''
        if (!name) throw new Error('An alarm name is required')
        const info = record(args[1])
        const now = Date.now()
        const when = typeof info.when === 'number' ? info.when : undefined
        const delay =
          typeof info.delayInMinutes === 'number' ? info.delayInMinutes * 60_000 : undefined
        const period =
          typeof info.periodInMinutes === 'number' && info.periodInMinutes > 0
            ? info.periodInMinutes
            : undefined
        const alarm: AlarmRecord = {
          name,
          scheduledTime: when ?? now + (delay ?? 0),
          ...(period === undefined ? {} : { periodInMinutes: period }),
          persistAcrossSessions: info.persistAcrossSessions !== false
        }
        store[name] = alarm
        save()
        schedule(context.profileId, context.extensionId, alarm)
        return undefined
      }
      if (method === 'get') {
        const name = typeof args[0] === 'string' ? args[0] : ''
        const alarm = store[name]
        return alarm ? publicAlarm(alarm) : undefined
      }
      if (method === 'getAll') {
        return Object.values(store).map(publicAlarm)
      }
      if (method === 'clear' || method === 'clearAll') {
        const names = method === 'clearAll' ? Object.keys(store) : [String(args[0] ?? '')]
        for (const name of names) {
          const key = timerKey(context.profileId, context.extensionId, name)
          const timer = timers.get(key)
          if (timer) clearTimeout(timer)
          timers.delete(key)
          delete store[name]
        }
        save()
        return undefined
      }
      throw new Error(`chrome.alarms.${method} is not supported.`)
    }
  })
}
