import type { ThemeMode } from '../../shared/types'

/** App-wide preferences that are not scoped to a browsing profile. */
export interface AppSettingsShape {
  themeMode?: ThemeMode
}
