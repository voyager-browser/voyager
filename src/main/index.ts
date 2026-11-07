import { app, protocol, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc/register'
import { registerVoyagerProtocol } from './protocol/voyagerProtocol'
import { attachPermissionHandlers } from './permissions/permissions'
import { attachContentBlocking, primeContentBlocking } from './contentBlocking/contentBlocking'
import { flushAllStores, getSettings } from './store'

import { WindowController } from './window/WindowController'
import {
  activeWindow,
  allWindows,
  registerWindow,
  windowForAnyWebContents
} from './window/windowRegistry'
import { createWindow, createIncognitoWindow } from './window/createWindow'
import { attachDownloadsTracking } from './downloads/downloads'
import { IpcChannels } from '../shared/ipc-channels'
import { findLaunchUrl } from './launch/urlArgument'

app.setName('Voyager')

// Must run before the app is ready. Registering the settings scheme as
// standard + secure lets relative asset URLs resolve and CORS-enabled module
// scripts load from voyager:// .
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'voyager',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let controller: WindowController | null = null
let pendingUrl: string | null = findLaunchUrl(process.argv)

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // Windows and Linux hand links to the already running process as a new
  // command-line argument; focus the window and open the link as a new tab.
  app.on('second-instance', (_event, argv) => {
    const url = findLaunchUrl(argv)
    const window = activeWindow()
    if (url) {
      if (window) window.openUrl(url)
      else pendingUrl = url
    } else {
      window?.window.focus()
    }
  })
}

// macOS delivers links (including default-browser clicks) through open-url.
app.on('open-url', (event, url) => {
  event.preventDefault()
  const window = activeWindow()
  if (window) window.openUrl(url)
  else pendingUrl = url
})

registerIpcHandlers({
  send: (channel, payload) => {
    for (const window of allWindows()) window.sendToChrome(channel, payload)
  },
  getWindow: (event) => windowForAnyWebContents(event?.sender) ?? activeWindow(),
  openWindow: (url) => {
    createWindow(url)
  },
  openIncognitoWindow: (url) => {
    createIncognitoWindow(url)
  }
})

// Persist any debounced store writes before the process goes away.
app.on('will-quit', () => {
  flushAllStores()
})

import { createAppMenu } from './menu/menu'

app.whenReady().then(async (): Promise<void> => {
  if (!hasSingleInstanceLock) return

  registerVoyagerProtocol(protocol)

  attachPermissionHandlers(session.defaultSession)
  if (getSettings('contentBlocking', false) === true) {
    primeContentBlocking(app.getPath('userData'))
  }
  attachContentBlocking(session.defaultSession)
  controller = new WindowController({ incognito: getSettings('incognito', false) === true })
  registerWindow(controller)
  createAppMenu(() => activeWindow())
  autoUpdater.checkForUpdatesAndNotify()
  controller.onDestroyed(() => {
    if (controller?.window.isDestroyed()) controller = null
  })
  attachDownloadsTracking(session.defaultSession, (state) => {
    for (const window of allWindows()) window.sendToChrome(IpcChannels.DownloadsStateChanged, state)
  })
  const initialUrl = pendingUrl
  pendingUrl = null
  await controller.show(initialUrl ?? undefined)
  if (pendingUrl) {
    activeWindow()?.openUrl(pendingUrl)
    pendingUrl = null
  }
})

app.on('activate', () => {
  if (allWindows().length === 0) {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
