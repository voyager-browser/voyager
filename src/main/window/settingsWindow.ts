import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { SETTINGS_URL } from '../../shared/constants'
import type { SettingsTarget } from '../../shared/types'

let settingsWindow: BrowserWindow | null = null

/**
 * In development the renderer is served by Vite, so the settings window has to
 * load the dev-server page instead of the (possibly stale) bundled file served
 * through the voyager:// protocol.
 */
function settingsBaseUrl(): string {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return devServerUrl ? `${devServerUrl.replace(/\/$/, '')}/settings.html` : SETTINGS_URL
}

function settingsUrlFor(target?: SettingsTarget): string {
  const base = settingsBaseUrl()
  if (target?.page === 'site-permissions') {
    const params = new URLSearchParams()
    if (target.origin) params.set('origin', target.origin)
    const query = params.toString()
    return `${base}#site-permissions${query ? `?${query}` : ''}`
  }
  if (target?.search) {
    const params = new URLSearchParams({ q: target.search })
    return `${base}#search?${params.toString()}`
  }
  return base
}

/** Open the settings window, or focus it when it is already open. */
export function openSettingsWindow(target?: SettingsTarget): void {
  const url = settingsUrlFor(target)
  const existing = settingsWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    if (target) void existing.loadURL(url)
    return
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Settings - Voyager',
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
  void win.loadURL(url)
}
