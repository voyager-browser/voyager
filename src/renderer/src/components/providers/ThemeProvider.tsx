import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  defaultBrowserTheme,
  defaultStartPage,
  mixColors,
  readableTextColor,
  relativeLuminance,
  THEME_COLOR_KEYS
} from '../../../../shared/theme'
import type {
  ThemeColorPatch,
  ThemeFileInput,
  ThemeMode,
  ThemeState,
  ThemeStartPageInput
} from '../../../../shared/types'
import { ThemeContext, type ThemeContextValue } from './theme-context'

const COLOR_VARIABLES: Record<(typeof THEME_COLOR_KEYS)[number], string> = {
  background: '--voyager-bg',
  foreground: '--voyager-fg',
  accent: '--voyager-accent',
  border: '--voyager-border',
  muted: '--voyager-muted',
  surface: '--voyager-surface'
}

function applyCssTheme(state: ThemeState): void {
  const root = document.documentElement
  root.classList.toggle('dark', state.dark)
  root.dataset.voyagerTheme = state.chrome.source
  const colors = state.chrome.colors
  if (state.chrome.source === 'default') {
    // Removing the inline overrides restores the light/dark/incognito CSS.
    for (const key of THEME_COLOR_KEYS) root.style.removeProperty(COLOR_VARIABLES[key])
    root.style.removeProperty('--voyager-accent-fg')
    root.style.removeProperty('--voyager-ring')
    root.style.removeProperty('--voyager-hover')
    root.style.removeProperty('--voyager-theme-image')
    root.style.removeProperty('--voyager-theme-overlay')
    return
  }
  for (const key of THEME_COLOR_KEYS) {
    root.style.setProperty(COLOR_VARIABLES[key], colors[key])
  }
  root.style.setProperty('--voyager-accent-fg', readableTextColor(colors.accent))
  root.style.setProperty('--voyager-ring', mixColors(colors.accent, colors.background, 0.65))
  root.style.setProperty('--voyager-hover', mixColors(colors.foreground, colors.background, 0.9))
  if (state.chrome.backgroundImage) {
    root.style.setProperty('--voyager-theme-image', `url("${state.chrome.backgroundImage}")`)
    root.style.setProperty(
      '--voyager-theme-overlay',
      relativeLuminance(colors.background) > 0.5
        ? 'rgba(255, 255, 255, 0.82)'
        : 'rgba(8, 8, 12, 0.66)'
    )
  } else {
    root.style.removeProperty('--voyager-theme-image')
    root.style.removeProperty('--voyager-theme-overlay')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<ThemeState>({
    mode: 'system',
    dark: false,
    chrome: defaultBrowserTheme(false),
    startPage: defaultStartPage()
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.voyager?.theme) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const update = (matches: boolean) =>
        setState({
          mode: 'system',
          dark: matches,
          chrome: defaultBrowserTheme(matches),
          startPage: defaultStartPage()
        })
      update(mq.matches)
      const listener = (e: MediaQueryListEvent) => update(e.matches)
      mq.addEventListener('change', listener)
      return () => mq.removeEventListener('change', listener)
    }
    void window.voyager.theme.get().then(setState)
    return window.voyager.theme.onChanged(setState)
  }, [])

  useEffect(() => {
    applyCssTheme(state)
  }, [state])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: state.mode,
      dark: state.dark,
      chrome: state.chrome,
      startPage: state.startPage,
      setMode: (mode: ThemeMode) => {
        if (window.voyager?.theme) {
          void window.voyager.theme.set(mode).then(setState)
        } else {
          const dark =
            mode === 'dark' ||
            (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
          setState({
            mode,
            dark,
            chrome: defaultBrowserTheme(dark),
            startPage: defaultStartPage()
          })
        }
      },
      setColors: (patch: ThemeColorPatch) => {
        if (window.voyager?.theme) {
          void window.voyager.theme.setColors(patch).then(setState)
        } else {
          setState((current) => ({
            ...current,
            chrome: {
              ...current.chrome,
              id: 'custom',
              name: 'Custom colors',
              source: 'custom',
              colors: { ...current.chrome.colors, ...patch }
            }
          }))
        }
      },
      setStartPage: async (input: ThemeStartPageInput) => {
        if (!window.voyager?.theme) return state
        const next = await window.voyager.theme.setStartPage(input)
        setState(next)
        return next
      },
      importFiles: async (files: ThemeFileInput[]) => {
        if (!window.voyager?.theme) return state
        const next = await window.voyager.theme.importFiles(files)
        setState(next)
        return next
      },
      importStore: async (url: string) => {
        if (!window.voyager?.theme) return state
        const next = await window.voyager.theme.importStore(url)
        setState(next)
        return next
      },
      resetTheme: () => {
        if (window.voyager?.theme) {
          void window.voyager.theme.reset().then(setState)
        } else {
          setState((current) => ({
            ...current,
            chrome: defaultBrowserTheme(current.dark),
            startPage: defaultStartPage()
          }))
        }
      }
    }),
    [state]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
