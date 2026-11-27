/**
 * One-time migration for Chrome themes that were installed as ordinary
 * extensions before Voyager persisted browser theme state. Without this,
 * an existing theme loads as an extension but never recolors Voyager's chrome.
 */

import { nativeTheme } from 'electron'
import { installedExtensionPaths } from '../extensions/extensions'
import { getSettings, setSettings } from '../store'
import { readThemeDirectory } from './chromeTheme'
import { importChromeThemeArtifact } from './theme'

const MIGRATION_KEY = 'installedThemeMigrated'

/** Adopt the first installed Chrome theme for a profile that has no theme set. */
export function migrateInstalledThemeExtension(profileId: string): void {
  if (getSettings<boolean>(profileId, MIGRATION_KEY, false) === true) return

  const dark = nativeTheme.shouldUseDarkColors
  if (getSettings(profileId, 'browserTheme') != null) {
    setSettings(profileId, MIGRATION_KEY, true)
    return
  }

  for (const path of installedExtensionPaths(profileId)) {
    try {
      const artifact = readThemeDirectory(path, dark)
      if (!artifact) continue
      importChromeThemeArtifact(profileId, artifact, dark)
      setSettings(profileId, MIGRATION_KEY, true)
      return
    } catch (error) {
      console.warn(`[theme] Could not migrate installed theme at ${path}:`, error)
    }
  }

  // Mark the migration complete even when no theme was installed, so a later
  // explicit theme reset cannot cause an old extension to be adopted again.
  setSettings(profileId, MIGRATION_KEY, true)
}
