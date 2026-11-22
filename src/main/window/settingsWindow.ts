import { join } from 'node:path'
import { app, BrowserWindow, type WebContents } from 'electron'
import { SETTINGS_URL } from '../../shared/constants'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles'
import type { SettingsTarget } from '../../shared/types'

let settingsWindow: BrowserWindow | null = null
/** Profile whose data the open settings window is showing. */
let settingsProfileId: string = DEFAULT_PROFILE_ID

/**
 * In development the renderer is served by Vite, so the settings window has to
 * load the dev-server page instead of the (possibly stale) bundled file served
 * through the voyager:// protocol.
 */
function settingsBaseUrl(): string {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const base = devServerUrl ? `${devServerUrl.replace(/\/$/, '')}/settings.html` : SETTINGS_URL
  // The renderer owns document.title on macOS, so pass the build flag in the
  // URL to let it apply the dev suffix synchronously without an IPC round trip.
  if (app.isPackaged) return base
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}dev=1`
}

function settingsUrlFor(target?: SettingsTarget): string {
  const base = settingsBaseUrl()
  if (target?.page === 'site-permissions') {
    const params = new URLSearchParams()
    if (target.origin) params.set('origin', target.origin)
    const query = params.toString()
    return `${base}#site-permissions${query ? `?${query}` : ''}`
  }
  if (target?.page === 'profiles') return `${base}#profiles`
  return base
}

/** Open the settings window, or focus it when it is already open. */
export function openSettingsWindow(target?: SettingsTarget, profileId?: string): void {
  const targetProfile = profileId ?? settingsProfileId
  const url = settingsUrlFor(target)
  const existing = settingsWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    if (target || targetProfile !== settingsProfileId) {
      settingsProfileId = targetProfile
      void existing.loadURL(url)
    }
    return
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: app.isPackaged ? 'Settings - Voyager' : 'Settings - Voyager (Dev)',
    backgroundColor: '#1a1b22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })

  settingsWindow = win
  settingsProfileId = targetProfile
  void win.loadURL(url)
}

/** Profile targeted by the settings window that owns `webContents`. */
export function settingsProfileFor(webContents: WebContents): string | null {
  if (!settingsWindow || settingsWindow.isDestroyed()) return null
  return settingsWindow.webContents === webContents ? settingsProfileId : null
}

/** Profile shown by the open settings window, or null when it is closed. */
export function settingsTargetProfileId(): string | null {
  if (!settingsWindow || settingsWindow.isDestroyed()) return null
  return settingsProfileId
}

/** Push a profile-scoped update to the settings window when it matches. */
export function sendToSettingsWindow(profileId: string, channel: string, payload?: unknown): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  if (settingsProfileId !== profileId) return
  settingsWindow.webContents.send(channel, payload)
}

/** Broadcast an app-wide update (theme, profile registry) to every window. */
export function sendToSettingsWindowAlways(channel: string, payload?: unknown): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  settingsWindow.webContents.send(channel, payload)
}
