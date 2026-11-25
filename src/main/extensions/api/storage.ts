import { getSettings, setSettings } from '../../store'

const STORAGE_KEY = 'extensionApiSettings'

function all(profileId: string): Record<string, unknown> {
  const stored = getSettings<Record<string, unknown>>(profileId, STORAGE_KEY, {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
}

/** Read one emulated API value from the profile's extension settings bucket. */
export function getApiSetting<T>(profileId: string, key: string, fallback: T): T {
  const value = all(profileId)[key]
  return value === undefined ? fallback : (value as T)
}

export function setApiSetting(profileId: string, key: string, value: unknown): void {
  const next = all(profileId)
  next[key] = value
  setSettings(profileId, STORAGE_KEY, next)
}

export function deleteApiSetting(profileId: string, key: string): void {
  const next = all(profileId)
  delete next[key]
  setSettings(profileId, STORAGE_KEY, next)
}

/** List persisted API keys belonging to one extension. */
export function listApiSettingKeys(profileId: string, prefix: string): string[] {
  return Object.keys(all(profileId)).filter((key) => key.startsWith(prefix))
}
