import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { SETTINGS_URL } from '../../shared/constants'
import type { SettingsTarget } from '../../shared/types'

let settingsWindow: BrowserWindow | null = null

function settingsUrlFor(target?: SettingsTarget): string {
  if (target?.page !== 'site-permissions') return SETTINGS_URL
  const params = new URLSearchParams()
  if (target.origin) params.set('origin', target.origin)
  const query = params.toString()
  return `${SETTINGS_URL}#site-permissions${query ? `?${query}` : ''}`
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
