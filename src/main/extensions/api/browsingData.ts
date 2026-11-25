import { session } from 'electron'
import { profilePartition } from '../../profiles/profiles'
import { storesFor } from '../../store'
import { registerExtensionApiHandler } from './registry'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const STORAGE_TYPES: Record<string, 'cookies' | 'localstorage' | 'indexdb'> = {
  cookies: 'cookies',
  localStorage: 'localstorage',
  indexedDB: 'indexdb'
}

async function clearData(
  profileId: string,
  since: number,
  types: Record<string, unknown>
): Promise<void> {
  const partition = profilePartition(profileId)
  const ses = partition ? session.fromPartition(partition) : session.defaultSession
  const storages = Object.entries(STORAGE_TYPES)
    .filter(([key]) => types[key] === true)
    .map(([, value]) => value)
  if (storages.length > 0) {
    await ses.clearStorageData({ storages })
  }
  if (types.cache === true || types.cacheStorage === true) {
    await ses.clearCache()
  }
  const stores = storesFor(profileId)
  if (types.history === true) {
    stores.history.update('entries', (entries) =>
      entries.filter((entry) => entry.visitedAt < since)
    )
  }
  if (types.downloads === true) {
    stores.downloads.update('items', (items) =>
      items.filter((item) => (item.startTime || 0) < since)
    )
  }
  if (types.formData === true) {
    stores.autofill.set('formHistory', [])
  }
}

export function registerBrowsingData(): void {
  registerExtensionApiHandler('browsingData', {
    permissions: ['browsingData'],
    async invoke(context, method, args): Promise<unknown> {
      if (method !== 'removeData' && method !== 'removeDataType') {
        throw new Error(`chrome.browsingData.${method} is not supported.`)
      }
      const since = typeof args[0] === 'number' ? args[0] : 0
      const types = method === 'removeData' ? record(args[1]) : { [String(args[1] ?? '')]: true }
      await clearData(context.profileId, since, types)
      return undefined
    }
  })
}
