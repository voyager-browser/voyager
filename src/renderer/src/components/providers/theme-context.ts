import { createContext, useContext } from 'react'
import type {
  BrowserTheme,
  StartPageBackground,
  ThemeColorPatch,
  ThemeFileInput,
  ThemeMode,
  ThemeStartPageInput,
  ThemeState
} from '../../../../shared/types'

export interface ThemeContextValue {
  mode: ThemeMode
  dark: boolean
  chrome: BrowserTheme
  startPage: StartPageBackground
  setMode: (mode: ThemeMode) => void
  setColors: (patch: ThemeColorPatch) => void
  setStartPage: (input: ThemeStartPageInput) => Promise<ThemeState>
  importFiles: (files: ThemeFileInput[]) => Promise<ThemeState>
  importStore: (url: string) => Promise<ThemeState>
  resetTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Access the resolved theme mode/state for the chrome UI. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
