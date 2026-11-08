import { expect, test } from './fixtures'
import { openSettings } from './helpers/voyager'

test('exposes the typed preload API to the chrome renderer', async ({ voyager }) => {
  const api = await voyager.chrome.evaluate(() => ({
    platform: window.voyager.platform,
    namespaces: Object.keys(window.voyager).sort(),
    settings: Object.keys(window.voyager.settings),
    tabs: Object.keys(window.voyager.tabs),
    navigation: Object.keys(window.voyager.navigation),
    bookmarks: Object.keys(window.voyager.bookmarks),
    browsingData: Object.keys(window.voyager.browsingData),
    defaultBrowser: Object.keys(window.voyager.defaultBrowser),
    history: Object.keys(window.voyager.history),
    downloads: Object.keys(window.voyager.downloads),
    permissions: Object.keys(window.voyager.permissions),
    ui: Object.keys(window.voyager.ui),
    windows: Object.keys(window.voyager.windows)
  }))

  expect(api.platform).toBe(process.platform)
  expect(api.namespaces).toEqual([
    'appInfo',
    'bookmarks',
    'browsingData',
    'certificates',
    'defaultBrowser',
    'downloads',
    'history',
    'navigation',
    'permissions',
    'platform',
    'settings',
    'tabs',
    'theme',
    'ui',
    'windows'
  ])
  expect(api.settings).toEqual(['get', 'open', 'set', 'onChanged'])
  expect(api.browsingData).toEqual(['clear'])
  expect(api.defaultBrowser).toEqual(['isDefault', 'setDefault'])
  expect(api.tabs).toEqual(
    expect.arrayContaining(['getState', 'create', 'close', 'activate', 'reorder', 'pinToggle'])
  )
  expect(api.navigation).toEqual(
    expect.arrayContaining(['go', 'back', 'forward', 'reload', 'findInPage', 'zoomIn'])
  )
  expect(api.windows).toEqual(expect.arrayContaining(['open', 'openIncognito', 'getState']))
  expect(api.permissions).toEqual(
    expect.arrayContaining([
      'getState',
      'getForOrigin',
      'remove',
      'clear',
      'respond',
      'onRequest',
      'onStateChanged'
    ])
  )
  expect(api.ui).toEqual(
    expect.arrayContaining([
      'onFocusOmnibox',
      'onFindInPage',
      'onOpenHistory',
      'onOpenDownloads',
      'onPromptRequest',
      'respondToPrompt'
    ])
  )
})

test('reports application and runtime versions', async ({ voyager }) => {
  const info = await voyager.chrome.evaluate(() => window.voyager.appInfo())
  const runtime = await voyager.app.evaluate(({ app }) => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  expect(info).toEqual(runtime)
  expect(info.app).toBe('1.0.0')
  expect(info.electron).toBeTruthy()
  expect(info.chrome).toBeTruthy()
  expect(info.node).toBeTruthy()
})

test('does not leak Node globals into the chrome renderer', async ({ voyager }) => {
  const globals = await voyager.chrome.evaluate(() => ({
    require: 'require' in window,
    process: 'process' in window,
    module: 'module' in window,
    voyager: 'voyager' in window
  }))

  expect(globals).toEqual({ require: false, process: false, module: false, voyager: true })
})

test('does not expose Node or the preload API to tab pages', async ({ voyager }) => {
  const globals = await voyager.tab.evaluate(() => ({
    require: 'require' in window,
    process: 'process' in window,
    module: 'module' in window,
    voyager: 'voyager' in window
  }))

  expect(globals).toEqual({ require: false, process: false, module: false, voyager: false })
})

test('exposes the preload API inside the settings window', async ({ voyager }) => {
  const settings = await openSettings(voyager)
  const theme = await settings.evaluate(() => window.voyager.theme.get())
  const systemDark = await voyager.app.evaluate(
    ({ nativeTheme }) => nativeTheme.shouldUseDarkColors
  )
  const globals = await settings.evaluate(() => ({
    require: 'require' in window,
    voyager: 'voyager' in window
  }))

  expect(theme.mode).toBe('system')
  expect(theme.dark).toBe(systemDark)
  expect(globals).toEqual({ require: false, voyager: true })
})
