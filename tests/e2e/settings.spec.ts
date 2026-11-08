import { expect, test } from './fixtures'
import { openSettings, windowCount } from './helpers/voyager'
import { primaryKey } from './helpers/voyager'

test('opens settings with the Cmd/Ctrl+, shortcut', async ({ voyager }) => {
  const before = await windowCount(voyager.app)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Comma`)

  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)
})

test('exposes a Settings menu entry with an accelerator', async ({ voyager }) => {
  test.skip(process.platform !== 'darwin', 'Settings menu is macOS-only')
  const accelerator = await voyager.app.evaluate(({ Menu }) => {
    const menus = Menu.getApplicationMenu()?.items ?? []
    for (const menu of menus) {
      const match = menu.submenu?.items.find((item: any) => /Settings/.test(item.label ?? ''))
      if (match) return match.accelerator
    }
    return null
  })

  expect(accelerator).toContain(',')
})

test('opens settings in a separate managed popup window', async ({ voyager }) => {
  const before = await windowCount(voyager.app)
  const settings = await openSettings(voyager)

  await expect(settings).toHaveTitle('Settings - Voyager')
  expect(settings.url()).toContain('voyager://settings')
  expect(await windowCount(voyager.app)).toBe(before + 1)
})

test('settings exposes default browser controls', async ({ voyager }) => {
  const settings = await openSettings(voyager)

  await expect(settings.getByText('Default browser', { exact: true })).toBeVisible()
  const current = await settings.evaluate(() => window.voyager.defaultBrowser.isDefault())
  expect(typeof current).toBe('boolean')
})

test('settings page shows stats and lets theme change apply to itself', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/home'))
  const settings = await openSettings(voyager)

  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settings.getByText(/^Active tab:/)).toHaveCount(0)
  await expect(settings.getByText(/^Voyager \d+\.\d+\.\d+/)).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Appearance' })).toBeVisible()

  // Click dark theme.
  await settings.getByLabel('dark').click()
  const darkApplied = await settings.evaluate(() =>
    document.documentElement.classList.contains('dark')
  )
  expect(darkApplied).toBe(true)

  const mode = await settings.evaluate(() => window.voyager.theme.get())
  expect(mode.mode).toBe('dark')
  expect(mode.dark).toBe(true)

  // Persisted to disk under the userData dir.
  const persisted = await voyager.app.evaluate(({ app }) => app.getPath('userData'))
  expect(persisted).toBeTruthy()
})

test('theme changes broadcast to the chrome window', async ({ voyager }) => {
  const settings = await openSettings(voyager)
  await settings.getByLabel('dark').click()

  await expect
    .poll(async () => {
      const chromeTheme = await voyager.chrome.evaluate(() => window.voyager.theme.get())
      return chromeTheme.mode
    })
    .toBe('dark')

  await expect
    .poll(async () => {
      return await voyager.chrome.evaluate(() =>
        document.documentElement.classList.contains('dark')
      )
    })
    .toBe(true)

  // Revert.
  await settings.getByLabel('system').click()
  await expect
    .poll(async () => {
      const chromeTheme = await voyager.chrome.evaluate(() => window.voyager.theme.get())
      return chromeTheme.mode
    })
    .toBe('system')
})

test('reloads open pages after an explicit theme-mode change', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/count'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/count'))
  const hitsBefore = server.hits('/count')

  const settings = await openSettings(voyager)
  const current = await settings.evaluate(() => window.voyager.theme.get())
  await settings.getByLabel(current.mode === 'dark' ? 'light' : 'dark').click()

  await expect.poll(() => server.hits('/count')).toBeGreaterThan(hitsBefore)
})

test('vertical tabs toggle persists and updates the chrome window', async ({ voyager }) => {
  const settings = await openSettings(voyager)

  await settings.getByLabel(/Use vertical tabs/).check()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).verticalTabs)
    .toBe(true)
  await expect(voyager.chrome.locator('aside[aria-label="Tabs"]')).toBeVisible()

  await settings.getByLabel(/Use vertical tabs/).uncheck()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).verticalTabs)
    .toBe(false)
  await expect(voyager.chrome.locator('aside[aria-label="Tabs"]')).toHaveCount(0)
})

test('clear browsing data preferences persist', async ({ voyager }) => {
  const settings = await openSettings(voyager)

  await expect(settings.getByLabel('Browsing history')).toBeChecked()
  await settings.getByLabel('Bookmarks').check()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).clearBookmarks)
    .toBe(true)

  await settings.getByLabel('Browsing history').uncheck()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).clearHistory)
    .toBe(false)
})

test('site data clearing options default to on and persist', async ({ voyager }) => {
  const settings = await openSettings(voyager)

  for (const label of [
    'Cookies',
    'Local storage',
    'IndexedDB',
    'Cached images and files',
    'Site permissions'
  ]) {
    await expect(settings.getByLabel(label)).toBeChecked()
  }

  await settings.getByLabel('Cookies').uncheck()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).clearCookies)
    .toBe(false)
})

test('clear selected data removes cookies, local storage and IndexedDB', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/home'))
  await voyager.tab.evaluate(async () => {
    document.cookie = 'voyager_test=1; path=/'
    localStorage.setItem('voyager_test', '1')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voyager-test', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('store')
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  })

  expect(await voyager.tab.evaluate(() => document.cookie)).toContain('voyager_test=1')
  expect(await voyager.tab.evaluate(() => localStorage.getItem('voyager_test'))).toBe('1')

  const settings = await openSettings(voyager)
  await settings.getByRole('button', { name: 'Clear selected data' }).click()

  await expect
    .poll(async () => voyager.tab.evaluate(() => document.cookie))
    .not.toContain('voyager_test=1')
  await expect
    .poll(async () => voyager.tab.evaluate(() => localStorage.getItem('voyager_test')))
    .toBeNull()
  await expect
    .poll(async () => voyager.tab.evaluate(async () => (await indexedDB.databases()).length))
    .toBe(0)
})

test('clear selected data removes history when selected', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(1)

  const settings = await openSettings(voyager)
  await settings.getByRole('button', { name: 'Clear selected data' }).click()

  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(0)
})

test('shows a settings gear on non-mac platforms', async ({ voyager }) => {
  test.skip(process.platform === 'darwin', 'settings gear hidden on macOS')
  await expect(voyager.chrome.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('opens settings from the titlebar gear', async ({ voyager }) => {
  test.skip(process.platform === 'darwin', 'settings gear hidden on macOS')
  const before = await windowCount(voyager.app)
  await voyager.chrome.getByRole('button', { name: 'Settings' }).click()
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)
})
