import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { deleteApiSetting, getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

type AreaName = 'local' | 'sync' | 'session' | 'managed'
const AREAS: AreaName[] = ['local', 'sync', 'session', 'managed']

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const keyFor = (area: AreaName, extensionId: string): string => `storage:${area}:${extensionId}`

function readArea(context: ExtensionApiContext, area: AreaName): Record<string, unknown> {
  const stored = getApiSetting<Record<string, unknown>>(
    context.profileId,
    keyFor(area, context.extensionId),
    {}
  )
  if (area === 'managed') {
    const schema = record(record(context.manifest.storage).managed_schema)
    return { ...schema, ...(stored && typeof stored === 'object' ? stored : {}) }
  }
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
}

function emitChanges(
  context: ExtensionApiContext,
  area: AreaName,
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
): void {
  if (Object.keys(changes).length === 0) return
  broadcastExtensionApiEvent(
    context.profileId,
    {
      path: ['storage'],
      event: 'onChanged',
      args: [changes, area],
      extensionId: context.extensionId
    },
    'storage'
  )
}

function selectedKeys(args: unknown[]): string[] {
  const first = args[0]
  if (typeof first === 'string') return [first]
  if (Array.isArray(first))
    return first.filter((value): value is string => typeof value === 'string')
  return Object.keys(record(first))
}

function valuesFor(
  stored: Record<string, unknown>,
  keys: string[],
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) result[key] = stored[key]
    else if (Object.prototype.hasOwnProperty.call(defaults, key)) result[key] = defaults[key]
  }
  return result
}

export function registerStorageApi(): void {
  for (const area of AREAS) {
    registerExtensionApiHandler(`storage.${area}`, {
      permissions: area === 'managed' ? [] : ['storage'],
      invoke(context, method, args): unknown {
        const stored = readArea(context, area)
        const writable = area !== 'managed'
        const save = (next: Record<string, unknown>): void =>
          setApiSetting(context.profileId, keyFor(area, context.extensionId), next)
        const defaults = record(args[args.length - 1])

        if (method === 'get') {
          const keys = selectedKeys(args)
          if (keys.length === 0) return { ...stored }
          return valuesFor(stored, keys, defaults)
        }
        if (method === 'getBytesInUse') {
          const keys = selectedKeys(args)
          const values = keys.length === 0 ? stored : valuesFor(stored, keys, {})
          return new TextEncoder().encode(JSON.stringify(values)).length
        }
        if (!writable) throw new Error(`chrome.storage.${area}.${method} is read-only.`)
        if (method === 'set') {
          const input = record(args[0])
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
          for (const [key, value] of Object.entries(input)) {
            changes[key] = { oldValue: stored[key], newValue: value }
            if (value === undefined) delete stored[key]
            else stored[key] = value
          }
          save(stored)
          emitChanges(context, area, changes)
          return undefined
        }
        if (method === 'remove') {
          const keys = selectedKeys(args)
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
          for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(stored, key)) continue
            changes[key] = { oldValue: stored[key] }
            delete stored[key]
          }
          if (Object.keys(changes).length > 0) save(stored)
          emitChanges(context, area, changes)
          return undefined
        }
        if (method === 'clear') {
          const changes: Record<string, { oldValue?: unknown }> = {}
          for (const [key, value] of Object.entries(stored)) changes[key] = { oldValue: value }
          deleteApiSetting(context.profileId, keyFor(area, context.extensionId))
          emitChanges(context, area, changes)
          return undefined
        }
        throw new Error(`chrome.storage.${area}.${method} is not supported.`)
      }
    })
  }
}
