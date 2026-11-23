/**
 * Shared theme model and color helpers. This module has no Electron imports so
 * the renderer, main process and tests can all use the same derivation rules.
 */

import type {
  BrowserTheme,
  BrowserThemeColors,
  BrowserThemeSource,
  StartPageBackground,
  ThemeColorKey,
  ThemeColorPatch
} from './types'

export const THEME_COLOR_KEYS: readonly ThemeColorKey[] = [
  'background',
  'foreground',
  'accent',
  'border',
  'muted',
  'surface'
]

/** Match the semantic tokens in globals.css. */
export const LIGHT_THEME_COLORS: BrowserThemeColors = {
  background: '#f2f2f5',
  foreground: '#1c1c20',
  accent: '#3478f6',
  border: '#d9d9e0',
  muted: '#6d6d76',
  surface: '#ffffff'
}

export const DARK_THEME_COLORS: BrowserThemeColors = {
  background: '#17171c',
  foreground: '#e9e9ee',
  accent: '#4c8dff',
  border: '#3b3b45',
  muted: '#9595a0',
  surface: '#232329'
}

export interface StartPageThemeParams {
  profileId?: string
  background?: StartPageBackground
  colors?: BrowserThemeColors
  version?: number
}

const THEME_SOURCE_VALUES: readonly BrowserThemeSource[] = [
  'default',
  'custom',
  'chrome-crx',
  'chrome-manifest'
]

const THEME_ASSET_PATTERN = /^voyager:\/\/theme\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+(?:\?v=\d+)?$/

export function defaultColors(dark: boolean): BrowserThemeColors {
  return { ...(dark ? DARK_THEME_COLORS : LIGHT_THEME_COLORS) }
}

export function defaultBrowserTheme(dark: boolean): BrowserTheme {
  return {
    id: 'default',
    name: 'Voyager',
    source: 'default',
    colors: defaultColors(dark)
  }
}

export function defaultStartPage(): StartPageBackground {
  return { kind: 'default' }
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(255, Math.max(0, Math.round(value)))
}

function hexFromRgb(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => clampByte(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function rgbFromHex(hex: string): [number, number, number] {
  const value = hex.slice(1)
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16)
  ]
}

/** Normalize Chrome's `[r, g, b]` arrays, CSS hex and `rgb()` values to `#rrggbb`. */
export function normalizeHexColor(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length < 3) return null
    const channels = value.slice(0, 3).map((channel) => Number(channel))
    if (channels.some((channel) => !Number.isFinite(channel))) return null
    // Chrome manifest colors are 0-255. Accept fractional 0-1 triples only
    // when a decimal makes the intent unambiguous (e.g. [0.5, 0.5, 0.5]).
    const fractional =
      channels.every((channel) => channel >= 0 && channel <= 1) &&
      channels.some((channel) => !Number.isInteger(channel))
    const scale = fractional ? 255 : 1
    return hexFromRgb(channels[0] * scale, channels[1] * scale, channels[2] * scale)
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null

  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(
    trimmed
  )
  if (rgb) {
    return hexFromRgb(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
  }

  const hex = trimmed.replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex) || /^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex.toLowerCase()}`
  }
  return null
}

export function relativeLuminance(color: string): number {
  const [red, green, blue] = rgbFromHex(normalizeHexColor(color) ?? '#000000').map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Pick black or white, whichever is readable on the supplied background. */
export function readableTextColor(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background)
    ? '#ffffff'
    : '#000000'
}

/** Blend `into` over `base`; weight is the amount of `into` (0-1). */
export function mixColors(base: string, into: string, weight: number): string {
  const amount = Math.min(1, Math.max(0, weight))
  const fromRgb = rgbFromHex(normalizeHexColor(base) ?? '#000000')
  const toRgb = rgbFromHex(normalizeHexColor(into) ?? '#000000')
  return hexFromRgb(
    fromRgb[0] + (toRgb[0] - fromRgb[0]) * amount,
    fromRgb[1] + (toRgb[1] - fromRgb[1]) * amount,
    fromRgb[2] + (toRgb[2] - fromRgb[2]) * amount
  )
}

/** Move a color toward black/white until it meets the requested contrast. */
export function ensureContrast(
  candidate: string,
  background: string,
  target: number,
  dark: boolean
): string {
  let result = normalizeHexColor(candidate) ?? (dark ? '#ffffff' : '#000000')
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (contrastRatio(result, background) >= target) return result
    const toward = relativeLuminance(background) > 0.5 ? '#000000' : '#ffffff'
    result = mixColors(result, toward, 0.12)
  }
  return result
}

function firstColor(colors: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeHexColor(colors[key])
    if (value) return value
  }
  return undefined
}

/**
 * Map Chrome theme colors onto Voyager's chrome tokens. Chrome stores theme
 * colors as `[r, g, b]` arrays and does not define an accent, so one is derived
 * from the frame color with a readable fallback.
 */
export function deriveChromeThemeColors(rawColors: unknown, dark: boolean): BrowserThemeColors {
  const defaults = defaultColors(dark)
  const colors: Record<string, unknown> =
    rawColors && typeof rawColors === 'object' ? (rawColors as Record<string, unknown>) : {}

  const surface = firstColor(colors, ['toolbar', 'ntp_background']) ?? defaults.surface
  const background = firstColor(colors, ['frame', 'frame_inactive', 'ntp_background']) ?? surface
  const text =
    firstColor(colors, ['tab_background_text', 'toolbar_text', 'bookmark_text']) ??
    readableTextColor(surface)
  const foreground = contrastRatio(text, surface) >= 4.5 ? text : readableTextColor(surface)
  const accentSource =
    firstColor(colors, ['accent', 'accent_color', 'tab_text', 'bookmark_text']) ??
    mixColors(background, dark ? '#4c8dff' : '#3478f6', 0.55)

  return {
    background,
    foreground,
    surface,
    accent: ensureContrast(accentSource, surface, 3, dark),
    border: mixColors(surface, foreground, 0.2),
    muted: ensureContrast(mixColors(foreground, surface, 0.35), surface, 3, dark)
  }
}

export function sanitizeColors(input: unknown, dark: boolean): BrowserThemeColors {
  const defaults = defaultColors(dark)
  const candidate = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const result = { ...defaults }
  for (const key of THEME_COLOR_KEYS) {
    result[key] = normalizeHexColor(candidate[key]) ?? defaults[key]
  }
  return result
}

export function sanitizeColorPatch(input: unknown): ThemeColorPatch {
  const candidate = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const patch: ThemeColorPatch = {}
  for (const key of THEME_COLOR_KEYS) {
    const color = normalizeHexColor(candidate[key])
    if (color) patch[key] = color
  }
  return patch
}

export function sanitizeTheme(input: unknown, dark: boolean): BrowserTheme | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<BrowserTheme> & Record<string, unknown>
  if (!candidate.colors || typeof candidate.colors !== 'object') return null
  const source = THEME_SOURCE_VALUES.includes(candidate.source as BrowserThemeSource)
    ? (candidate.source as BrowserThemeSource)
    : 'custom'
  const name =
    typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim().slice(0, 80)
      : 'Custom theme'
  const image = sanitizeThemeAssetUrl(candidate.backgroundImage)
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : 'custom',
    name,
    source,
    colors: sanitizeColors(candidate.colors, dark),
    ...(image ? { backgroundImage: image } : {}),
    ...(typeof candidate.version === 'string' ? { version: candidate.version } : {}),
    ...(typeof candidate.importedAt === 'number' ? { importedAt: candidate.importedAt } : {})
  }
}

export function sanitizeStartPage(input: unknown): StartPageBackground | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<StartPageBackground>
  if (candidate.kind === 'image') {
    const image = sanitizeThemeAssetUrl(candidate.image)
    return image ? { kind: 'image', image } : defaultStartPage()
  }
  if (candidate.kind === 'color') {
    const color = normalizeHexColor(candidate.color)
    return color ? { kind: 'color', color } : defaultStartPage()
  }
  return defaultStartPage()
}

export function themeAssetUrl(profileId: string, fileName: string): string {
  return `voyager://theme/${encodeURIComponent(profileId)}/${encodeURIComponent(fileName)}`
}

export function sanitizeThemeAssetUrl(value: unknown): string | undefined {
  return typeof value === 'string' && THEME_ASSET_PATTERN.test(value) ? value : undefined
}

/** Extract the stored file name from a theme asset URL, if it is valid. */
export function themeAssetFileName(value: unknown): string | undefined {
  const url = sanitizeThemeAssetUrl(value)
  if (!url) return undefined
  const path = url.replace('voyager://theme/', '').split('?', 1)[0]
  return path.slice(path.indexOf('/') + 1)
}
