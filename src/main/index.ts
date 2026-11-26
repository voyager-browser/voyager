import { app, protocol } from 'electron'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc/register'
import { flushAllStores, getSettings } from './store'

import { WindowController } from './window/WindowController'
import {
  activeWindow,
  allWindows,
  registerWindow,
  windowForAnyWebContents
} from './window/windowRegistry'
import { createWindow, createIncognitoWindow } from './window/createWindow'
import { findLaunchUrl } from './launch/urlArgument'
import { queuePendingUrls, takePendingUrls } from './launch/pendingUrls'
import { DEFAULT_PROFILE_ID } from '../shared/profiles'
import { lastProfileId } from './profiles/profiles'
import { ensureProfileSession, sessionForProfile } from './profiles/session'
import { cancelAllExtensionPermissions } from './extensions/extensionPermissions'
import { attachExtensions } from './extensions/extensions'
import { closeAllNativePorts } from './extensions/nativeMessaging'
import { startExtensionUpdateScheduler, stopExtensionUpdateScheduler } from './extensions/updates'

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
// No window exists yet at launch, so its URL joins any links delivered before
// the app is ready. Set until show() finishes so early events are also queued.
let starting = true
queuePendingUrls(webLinks(process.argv))

/** Keep only the web URLs a browser window knows how to open. */
function webLinks(values: readonly string[]): string[] {
  return values.map((value) => findLaunchUrl([value])).filter((url): url is string => url !== null)
}

/** Open links in the current window, or hold them until a window appears. */
function handleExternalUrls(urls: readonly string[]): void {
  const window = starting ? null : activeWindow()
  if (urls.length === 0) {
    window?.window.focus()
    return
  }
  if (window) {
    for (const url of urls) window.openUrl(url)
  } else {
    queuePendingUrls(urls)
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // Windows and Linux hand links to the already running process as new
  // command-line arguments; focus the window and open the links as new tabs.
  app.on('second-instance', (_event, argv) => {
    handleExternalUrls(webLinks(argv))
  })
}

// macOS delivers links (including default-browser clicks) through open-url.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleExternalUrls(webLinks([url]))
})

registerIpcHandlers({
  send: (channel, payload) => {
    for (const window of allWindows()) window.sendToChrome(channel, payload)
  },
  getWindow: (event) => windowForAnyWebContents(event?.sender) ?? activeWindow(),
  openWindow: (url, profileId) => {
    createWindow({ url, profileId })
  },
  openIncognitoWindow: (url, profileId) => {
    createIncognitoWindow(url, profileId)
  }
})

// Persist any debounced store writes before the process goes away.
app.on('will-quit', () => {
  stopExtensionUpdateScheduler()
  cancelAllExtensionPermissions()
  closeAllNativePorts()
  flushAllStores()
})

import { createAppMenu } from './menu/menu'

app.whenReady().then(async (): Promise<void> => {
  if (!hasSingleInstanceLock) return

  // The default profile's session also backs the settings window, so it is
  // always prepared even when the app starts in a named profile.
  ensureProfileSession(DEFAULT_PROFILE_ID)
  const startupProfileId = lastProfileId()
  ensureProfileSession(startupProfileId)
  // Have extension content scripts ready before the first page loads, so a
  // password manager can act on the start page immediately.
  await attachExtensions(sessionForProfile(DEFAULT_PROFILE_ID), DEFAULT_PROFILE_ID)
  await attachExtensions(sessionForProfile(startupProfileId), startupProfileId)

  controller = new WindowController({
    profileId: startupProfileId,
    incognito: getSettings(startupProfileId, 'incognito', false) === true
  })
  registerWindow(controller)
  createAppMenu()
  autoUpdater.checkForUpdatesAndNotify()
  controller.onDestroyed(() => {
    if (controller?.window.isDestroyed()) controller = null
  })
  const startupUrls = takePendingUrls()
  await controller.show(startupUrls[0])
  for (const url of startupUrls.slice(1)) controller.openUrl(url)
  // Non-blocking: a failed update check must never delay browser startup.
  startExtensionUpdateScheduler()
  starting = false
  // Links delivered during startup were queued rather than opened against a
  // half-initialized window; open them now, in arrival order.
  for (const url of takePendingUrls()) controller.openUrl(url)
})

app.on('activate', () => {
  if (allWindows().length === 0) {
    // createWindow drains any links queued while no window was open.
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
