import { app } from 'electron'
import { join } from 'node:path'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles'
import type { ThemeMode } from '../../shared/types'
import { Store } from './Store'
import type { AppSettingsShape } from './app'
import type { AutofillShape } from './autofill'
import { EMPTY_AUTOFILL } from './autofill'
import type { BookmarksShape } from './bookmarks'
import type { DownloadsShape } from './downloads'
import type { HistoryShape } from './history'
import type { PermissionsShape } from './permissions'
import type { SessionShape } from './session'
import type { SettingsShape } from './settings'

/** Every persisted store that belongs to one browsing profile. */
export interface ProfileStores {
  settings: Store<SettingsShape>
  session: Store<SessionShape>
  bookmarks: Store<BookmarksShape>
  history: Store<HistoryShape>
  downloads: Store<DownloadsShape>
  permissions: Store<PermissionsShape>
  autofill: Store<AutofillShape>
}

const bundles = new Map<string, ProfileStores>()

/** App-wide preferences (currently just the theme) live outside profiles. */
export const appStore = new Store<AppSettingsShape>('app.json', {})

/**
 * Directory that backs a profile's JSON stores. The default profile keeps
 * using the top-level userData directory so existing bookmarks, history and
 * preferences migrate implicitly; named profiles get a nested directory.
 */
export function profileDataDir(profileId: string): string {
  if (profileId === DEFAULT_PROFILE_ID) return app.getPath('userData')
  return join(app.getPath('userData'), 'profiles', profileId)
}

/** Lazily create (and cache) the store bundle for a profile. */
export function storesFor(profileId: string): ProfileStores {
  const existing = bundles.get(profileId)
  if (existing) return existing

  const directory = profileDataDir(profileId)
  const bundle: ProfileStores = {
    settings: new Store<SettingsShape>('settings.json', {}, directory),
    session: new Store<SessionShape>('session.json', { tabs: [], activeIndex: 0 }, directory),
    bookmarks: new Store<BookmarksShape>('bookmarks.json', { items: [], folders: [] }, directory),
    history: new Store<HistoryShape>('history.json', { entries: [] }, directory),
    downloads: new Store<DownloadsShape>('downloads.json', { items: [] }, directory),
    permissions: new Store<PermissionsShape>(
      'permissions.json',
      { decisions: [], autoRemovedDecisions: [] },
      directory
    ),
    autofill: new Store<AutofillShape>('autofill.json', { ...EMPTY_AUTOFILL }, directory)
  }
  bundles.set(profileId, bundle)
  return bundle
}

/** Drop a deleted profile's cached stores after flushing their writes. */
export function dropProfileStores(profileId: string): void {
  const bundle = bundles.get(profileId)
  if (!bundle) return
  for (const store of Object.values(bundle)) store.flush()
  bundles.delete(profileId)
}

export function getSettings<T = unknown>(
  profileId: string,
  key?: string,
  defaultValue?: T
): T | unknown {
  if (key === undefined) return defaultValue ?? ({} as unknown)
  const value = storesFor(profileId).settings.get(key as keyof SettingsShape)
  return value === undefined ? defaultValue : value
}

export function setSettings(profileId: string, key: string, value: unknown): void {
  storesFor(profileId).settings.set(key as keyof SettingsShape, value as never)
}

/** Resolve the app-wide theme, migrating the legacy per-profile setting. */
export function getThemeMode(): ThemeMode {
  const stored = appStore.get('themeMode')
  if (stored) return stored
  const legacy = storesFor(DEFAULT_PROFILE_ID).settings.get('themeMode')
  return legacy ?? 'system'
}

export function setThemeMode(mode: ThemeMode): void {
  appStore.set('themeMode', mode)
}

/** Persist every debounced store before the process goes away. */
export function flushAllStores(): void {
  appStore.flush()
  for (const bundle of bundles.values()) {
    for (const store of Object.values(bundle)) store.flush()
  }
}
