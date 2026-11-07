import { app, protocol, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc/register'
import { registerVoyagerProtocol } from './protocol/voyagerProtocol'
import { attachPermissionHandlers } from './permissions/permissions'
import { attachContentBlocking, primeContentBlocking } from './contentBlocking/contentBlocking'
import { flushAllStores, getSettings } from './store'

import { WindowController } from './window/WindowController'
import { registerWindow } from './window/windowRegistry'
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
    if (url) {
      if (controller) controller.openUrl(url)
      else pendingUrl = url
    } else {
      controller?.window.focus()
    }
  })
}

// macOS delivers links (including default-browser clicks) through open-url.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (controller) controller.openUrl(url)
  else pendingUrl = url
})

registerIpcHandlers({
  send: (channel, payload) => {
    controller?.sendToChrome(channel, payload)
  },
  getWindow: () => controller
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
  createAppMenu(() => controller)
  autoUpdater.checkForUpdatesAndNotify()
  controller.onDestroyed(() => {
    controller = null
  })
  attachDownloadsTracking(session.defaultSession, (state) =>
    controller?.sendToChrome(IpcChannels.DownloadsStateChanged, state)
  )
  const initialUrl = pendingUrl
  pendingUrl = null
  await controller.show(initialUrl ?? undefined)
  if (pendingUrl) {
    controller.openUrl(pendingUrl)
    pendingUrl = null
  }
})

app.on('activate', () => {
  if (controller === null) {
    void (async () => {
      controller = new WindowController({ incognito: getSettings('incognito', false) === true })
      registerWindow(controller)
      controller.onDestroyed(() => {
        controller = null
      })
      await controller.show()
    })()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
