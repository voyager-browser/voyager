/**
 * Per-profile browser themes. Palettes, start-page backgrounds and imported
 * Chrome theme assets live in the profile's settings store and theme folder;
 * every change is broadcast to that profile's windows and settings page.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeTheme } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import {
  defaultBrowserTheme,
  defaultStartPage,
  normalizeHexColor,
  sanitizeColorPatch,
  sanitizeColors,
  sanitizeStartPage,
  sanitizeTheme,
  themeAssetFileName,
  themeAssetUrl,
  type StartPageThemeParams
} from '../../shared/theme'
import type {
  BrowserTheme,
  StartPageBackground,
  ThemeColorPatch,
  ThemeFileInput,
  ThemeState,
  ThemeStartPageInput
} from '../../shared/types'
import { parseCrxTheme, parseThemeFiles, type ChromeThemeArtifact } from './chromeTheme'
import { downloadChromeWebStoreCrx } from './chromeStore'
import { getSettings, getThemeMode, profileDataDir, setSettings } from '../store'
import { sendToSettingsWindowAlways, settingsTargetProfileId } from '../window/settingsWindow'
import { allWindows } from '../window/windowRegistry'

const THEME_DIRECTORY = 'theme'
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}

function themeDirectory(profileId: string): string {
  return join(profileDataDir(profileId), THEME_DIRECTORY)
}

function decodeBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_BYTES * 2) {
    return null
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.replace(/\s/g, ''))) return null
  const buffer = Buffer.from(value.replace(/\s/g, ''), 'base64')
  return buffer.byteLength > 0 && buffer.byteLength <= MAX_IMAGE_BYTES ? buffer : null
}

function extensionForImage(name: string, mimeType: string): string | null {
  const fromMime = MIME_EXTENSIONS[mimeType.toLowerCase()]
  if (fromMime) return fromMime
  const fromName = name.toLowerCase().split('.').pop() ?? ''
  return Object.values(MIME_EXTENSIONS).includes(fromName) ? fromName : null
}

function saveThemeAsset(
  profileId: string,
  name: string,
  mimeType: string,
  data: Uint8Array
): string {
  const extension = extensionForImage(name, mimeType)
  if (!extension) throw new Error('Unsupported theme image format')
  if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Theme image is too large')
  }
  mkdirSync(themeDirectory(profileId), { recursive: true })
  const fileName = `${randomUUID()}.${extension}`
  writeFileSync(join(themeDirectory(profileId), fileName), data)
  return themeAssetUrl(profileId, fileName)
}

function removeThemeAsset(profileId: string, url: unknown): void {
  const fileName = themeAssetFileName(url)
  if (!fileName) return
  rmSync(join(themeDirectory(profileId), fileName), { force: true })
}

function readTheme(profileId: string, dark: boolean): BrowserTheme {
  const stored = sanitizeTheme(getSettings(profileId, 'browserTheme'), dark)
  return stored ?? defaultBrowserTheme(dark)
}

function readStartPage(profileId: string): StartPageBackground {
  return sanitizeStartPage(getSettings(profileId, 'startPageBackground')) ?? defaultStartPage()
}

/** Resolve the state shown by one window; incognito always uses safe defaults. */
export function themeStateFor(profileId: string, dark: boolean, incognito = false): ThemeState {
  return {
    mode: getThemeMode(),
    dark,
    chrome: incognito ? defaultBrowserTheme(dark) : readTheme(profileId, dark),
    startPage: incognito ? defaultStartPage() : readStartPage(profileId)
  }
}

/** Appearance carried by internal start-page URLs (no privileged IPC needed). */
export function startPageAppearance(
  profileId: string,
  dark: boolean,
  incognito = false
): StartPageThemeParams {
  // Incognito keeps its dedicated CSS palette, so no appearance is inlined.
  if (incognito) return { profileId }
  const state = themeStateFor(profileId, dark)
  return {
    profileId,
    background: state.startPage,
    colors: state.chrome.colors,
    ...(state.chrome.importedAt ? { version: state.chrome.importedAt } : {})
  }
}

function applyToWindows(profileId: string, state: ThemeState): void {
  for (const window of allWindows()) {
    if (window.profile !== profileId || window.window.isDestroyed()) continue
    if (!window.isIncognito) {
      try {
        window.window.setBackgroundColor(state.chrome.colors.background)
      } catch {
        // Some platforms cannot recolor a visible native frame; chrome CSS still applies.
      }
    }
    window.tabs.refreshStartPages()
  }
}

/** Send each window the right profile's state, including incognito overrides. */
export function broadcastThemeState(): void {
  for (const window of allWindows()) {
    if (window.window.isDestroyed()) continue
    window.sendToChrome(
      IpcChannels.ThemeChanged,
      themeStateFor(window.profile, nativeTheme.shouldUseDarkColors, window.isIncognito)
    )
  }
  const settingsProfile = settingsTargetProfileId()
  if (settingsProfile) {
    sendToSettingsWindowAlways(
      IpcChannels.ThemeChanged,
      themeStateFor(settingsProfile, nativeTheme.shouldUseDarkColors)
    )
  }
}

function finishChange(profileId: string, dark: boolean): ThemeState {
  const state = themeStateFor(profileId, dark)
  setSettings(profileId, 'startPageBackground', state.startPage)
  applyToWindows(profileId, state)
  broadcastThemeState()
  return state
}

/** Merge a user color patch into the profile's palette. */
export function setChromeColors(
  profileId: string,
  patch: ThemeColorPatch,
  dark: boolean
): ThemeState {
  const current = readTheme(profileId, dark)
  const colors = sanitizeColors({ ...current.colors, ...sanitizeColorPatch(patch) }, dark)
  const theme: BrowserTheme = {
    ...current,
    id: current.source === 'default' ? 'custom' : current.id,
    name: current.source === 'default' ? 'Custom colors' : current.name,
    source: 'custom',
    colors
  }
  setSettings(profileId, 'browserTheme', theme)
  return finishChange(profileId, dark)
}

/** Replace the New Tab background for one profile. */
export function setStartPage(
  profileId: string,
  input: ThemeStartPageInput,
  dark: boolean
): ThemeState {
  const previous = readStartPage(profileId)
  let next: StartPageBackground
  if (input.kind === 'image') {
    if (!input.image) throw new Error('Choose an image for the start page')
    const bytes = decodeBase64(input.image.data)
    if (!bytes) throw new Error('Image must be a PNG, JPEG, WebP, GIF or AVIF under 12 MB')
    const image = saveThemeAsset(profileId, input.image.name, input.image.mimeType, bytes)
    next = { kind: 'image', image }
  } else if (input.kind === 'color') {
    const color = normalizeHexColor(input.color)
    if (!color) throw new Error('Choose a valid start page color')
    next = { kind: 'color', color }
  } else {
    next = defaultStartPage()
  }

  const currentTheme = readTheme(profileId, dark)
  if (
    previous.image &&
    previous.image !== next.image &&
    currentTheme.backgroundImage !== previous.image
  ) {
    removeThemeAsset(profileId, previous.image)
  }
  setSettings(profileId, 'startPageBackground', next)
  return finishChange(profileId, dark)
}

/** Apply a parsed Chrome theme artifact to one profile. */
export function importChromeThemeArtifact(
  profileId: string,
  artifact: ChromeThemeArtifact,
  dark: boolean
): ThemeState {
  let backgroundImage: string | undefined
  if (artifact.image) {
    backgroundImage = saveThemeAsset(
      profileId,
      artifact.image.name,
      artifact.image.mimeType,
      artifact.image.data
    )
  }

  const previousTheme = readTheme(profileId, dark)
  const previousStart = readStartPage(profileId)
  const theme: BrowserTheme = {
    id: randomUUID(),
    name: artifact.name,
    source: artifact.source,
    colors: artifact.colors,
    ...(backgroundImage ? { backgroundImage } : {}),
    ...(artifact.version ? { version: artifact.version } : {}),
    importedAt: Date.now()
  }
  const startPage: StartPageBackground = backgroundImage
    ? { kind: 'image', image: backgroundImage }
    : previousStart

  const stillUsed = new Set(
    [theme.backgroundImage, startPage.image].filter((url): url is string => !!url)
  )
  const oldAssets = [previousTheme.backgroundImage, previousStart.image].filter(
    (url): url is string => !!url && !stillUsed.has(url)
  )
  for (const asset of oldAssets) removeThemeAsset(profileId, asset)

  setSettings(profileId, 'browserTheme', theme)
  setSettings(profileId, 'startPageBackground', startPage)
  return finishChange(profileId, dark)
}

/** Import a Chrome theme pack (CRX/ZIP) or loose manifest and image files. */
export function importChromeTheme(
  profileId: string,
  files: ThemeFileInput[],
  dark: boolean
): ThemeState {
  const archive = files.find((file) => /\.(crx|zip)$/i.test(file.name))
  const artifact = archive
    ? parseCrxTheme(Buffer.from(archive.data, 'base64'), dark)
    : parseThemeFiles(files, dark)
  return importChromeThemeArtifact(profileId, artifact, dark)
}

/** Download and apply a Chrome theme directly from a Chrome Web Store URL. */
export async function importChromeStoreTheme(
  profileId: string,
  input: string,
  dark: boolean
): Promise<ThemeState> {
  const bytes = await downloadChromeWebStoreCrx(input)
  const artifact = parseCrxTheme(bytes, dark)
  return importChromeThemeArtifact(profileId, { ...artifact, source: 'chrome-store' }, dark)
}

/** Restore Voyager's default palette and start page for one profile. */
export function resetTheme(profileId: string, dark: boolean): ThemeState {
  const previousTheme = readTheme(profileId, dark)
  const previousStart = readStartPage(profileId)
  for (const asset of [previousTheme.backgroundImage, previousStart.image]) {
    removeThemeAsset(profileId, asset)
  }
  setSettings(profileId, 'browserTheme', undefined)
  setSettings(profileId, 'startPageBackground', undefined)
  return finishChange(profileId, dark)
}
