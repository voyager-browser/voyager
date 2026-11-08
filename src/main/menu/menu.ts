import { app, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { WindowController } from '../window/WindowController'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles'
import { USER_AGENT_PRESETS, userAgentPresetId } from '../../shared/user-agent'
import { getSettings, setSettings } from '../store'
import { applyUserAgentForProfile } from '../userAgent/userAgent'
import { sessionForProfile } from '../profiles/session'
import { openSettingsWindow } from '../window/settingsWindow'
import { createWindow, createIncognitoWindow } from '../window/createWindow'
import { activeWindow } from '../window/windowRegistry'

let menuController: (() => WindowController | null) | undefined

export function refreshAppMenu(): void {
  createAppMenu(menuController)
}

export function createAppMenu(getController?: () => WindowController | null): void {
  menuController = getController
  const isMac = process.platform === 'darwin'
  const controller = (): WindowController | null =>
    (getController ? getController() : null) ?? activeWindow()

  const recentClosed: MenuItemConstructorOptions[] =
    controller()
      ?.tabs.getClosedTabs()
      .map((entry, index) => ({
        label: entry.title || entry.url,
        click: () => {
          controller()?.tabs.reopenClosedTab(index)
        }
      })) ?? []
  if (recentClosed.length === 0) {
    recentClosed.push({ label: 'No Recent Tabs', enabled: false })
  }

  const openHistory = (promptClear: boolean): void => {
    const window = controller()
    const webContents = window?.chrome.webContents
    if (!webContents) return
    void webContents.executeJavaScript(`window.dispatchEvent(new Event("voyager:open-history"))`)
    if (promptClear) {
      void webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent("voyager:open-history-clear"))`
      )
    }
  }

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+Comma',
          icon: nativeImage.createMenuSymbol('gearshape'),
          click: () => openSettingsWindow(undefined, controller()?.profile)
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+N',
        click: () => createWindow({ profileId: controller()?.profile })
      },
      {
        label: 'New Incognito Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => createIncognitoWindow(undefined, controller()?.profile)
      },
      { type: 'separator' },
      { role: 'close' },
      ...(isMac ? [] : ([{ role: 'quit' }] as const))
    ]
  })

  template.push({
    label: 'Edit',
    submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
  })

  const profileId = controller()?.profile ?? DEFAULT_PROFILE_ID
  const developerMode = getSettings(profileId, 'developerMode', false) === true
  const currentUserAgent =
    typeof getSettings(profileId, 'userAgent', '') === 'string'
      ? (getSettings(profileId, 'userAgent', '') as string)
      : ''
  const uaPreset = userAgentPresetId(currentUserAgent)

  const viewSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click: () => controller()?.tabs.reload()
    },
    {
      label: 'Toggle Developer Tools',
      accelerator: 'Alt+CmdOrCtrl+I',
      click: () => controller()?.tabs.toggleDevTools()
    },
    { type: 'separator' },
    {
      label: 'Actual Size',
      accelerator: 'CmdOrCtrl+0',
      click: () => controller()?.tabs.zoomReset()
    },
    {
      label: 'Zoom In',
      accelerator: 'CmdOrCtrl+Plus',
      click: () => controller()?.tabs.zoomIn()
    },
    {
      label: 'Zoom Out',
      accelerator: 'CmdOrCtrl+-',
      click: () => controller()?.tabs.zoomOut()
    },
    { type: 'separator' },
    {
      label: 'Show Bookmarks Bar',
      type: 'checkbox',
      checked: getSettings(profileId, 'bookmarksBarVisible') === true,
      accelerator: 'CmdOrCtrl+Shift+B',
      click: () => {
        controller()?.toggleBookmarksBar()
      }
    },
    {
      label: 'Developer Mode',
      type: 'checkbox',
      checked: developerMode,
      click: () => {
        const pid = controller()?.profile ?? DEFAULT_PROFILE_ID
        const next = !(getSettings(pid, 'developerMode', false) === true)
        setSettings(pid, 'developerMode', next)
        refreshAppMenu()
      }
    }
  ]

  if (developerMode) {
    viewSubmenu.push(
      { type: 'separator' },
      {
        label: 'For Developers',
        submenu: [
          {
            label: 'User Agent',
            submenu: USER_AGENT_PRESETS.map((preset) => ({
              label: preset.label,
              type: 'radio' as const,
              checked: uaPreset === preset.id,
              click: (): void => {
                const pid = controller()?.profile ?? DEFAULT_PROFILE_ID
                setSettings(pid, 'userAgent', preset.userAgent)
                applyUserAgentForProfile(sessionForProfile(pid), pid)
                refreshAppMenu()
              }
            }))
          }
        ]
      }
    )
  }

  template.push({ label: 'View', submenu: viewSubmenu })

  template.push({
    label: 'Bookmarks',
    submenu: [
      {
        label: 'Bookmark This Page',
        accelerator: 'CmdOrCtrl+D',
        click: () => controller()?.bookmarkActivePage()
      },
      { type: 'separator' },
      {
        label: 'Bookmarks Manager',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => controller()?.sendToChrome(IpcChannels.UiOpenBookmarksManager)
      }
    ]
  })

  template.push({
    label: 'History',
    submenu: [
      { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => openHistory(false) },
      { type: 'separator' },
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => controller()?.tabs.goBack() },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => controller()?.tabs.goForward() },
      { type: 'separator' },
      {
        label: 'Reopen Closed Tab',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => controller()?.tabs.reopenLastClosed()
      },
      { label: 'Recently Closed', submenu: recentClosed },
      { type: 'separator' },
      { label: 'Clear History…', click: () => openHistory(true) }
    ]
  })

  template.push({
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'close' }]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
