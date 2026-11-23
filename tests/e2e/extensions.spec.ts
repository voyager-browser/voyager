import { join } from 'node:path'
import { expect, test } from './fixtures'
import { openSettings, windowCount } from './helpers/voyager'

const EXTENSIONS_DIR = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'extensions')
const EXTENSION_PATH = join(EXTENSIONS_DIR, 'password-filler')
const CRX_PATH = join(EXTENSIONS_DIR, 'password-filler.crx')

test('runs content scripts from an unpacked extension installed at startup', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })

  const state = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  expect(state).toEqual([
    expect.objectContaining({
      name: 'Voyager E2E Password Filler',
      path: EXTENSION_PATH,
      loaded: true
    })
  ])
  expect(state[0]?.action?.iconUrl).toMatch(/^data:image\/png;base64,/)

  const input = voyager.chrome.locator('#omnibox-input')
  await input.fill(server.url('/home'))
  await input.press('Enter')
  await voyager.waitForTab((tab) => tab.url === server.url('/home'))
  await expect(voyager.tab.locator('#voyager-e2e-extension')).toBeAttached({ timeout: 15_000 })
})

test('installs and removes an unpacked extension for the profile', async ({ voyager }) => {
  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    EXTENSION_PATH
  )
  expect(installed).toEqual([
    expect.objectContaining({ name: 'Voyager E2E Password Filler', loaded: true })
  ])

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    EXTENSION_PATH
  )
  expect(removed).toEqual([])
})

test('unpacks and installs a CRX extension', async ({ voyager }) => {
  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    CRX_PATH
  )
  expect(installed).toEqual([
    expect.objectContaining({
      name: 'Voyager E2E Password Filler',
      loaded: true
    })
  ])
  expect(installed[0].path).not.toBe(CRX_PATH)

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    installed[0].path
  )
  expect(removed).toEqual([])
})

test('opens an extension action popup inside the browser window', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()
  const before = await windowCount(voyager.app)

  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  // The popup is an in-window child view, not a second BrowserWindow.
  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) => contents.getURL().startsWith('chrome-extension://'))
      )
    )
    .toBe(true)
  expect(await windowCount(voyager.app)).toBe(before)

  const popupText = await voyager.app.evaluate(({ webContents }) => {
    const popup = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('chrome-extension://'))
    return popup?.executeJavaScript(
      "document.querySelector('#voyager-extension-popup')?.textContent ?? ''"
    )
  })
  expect(popupText).toBe('password-filler-popup')

  // The chrome view must stay at its normal size: expanding it over the whole
  // window is what previously blanked the tab strip and blocked dragging.
  await expect(voyager.chrome.getByRole('tab')).toBeVisible()
  await expect(voyager.chrome.getByRole('button', { name: 'Extensions' })).toBeVisible()
})

test('opens a Chrome-style HTML extension menu with grouped actions', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  await expect(voyager.chrome.getByRole('button', { name: 'Extensions' })).toBeVisible()
  const opened = await voyager.chrome.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Extensions'
    )
    const rect = button?.getBoundingClientRect()
    return window.voyager.extensions.showActionMenu(rect?.right ?? 0, rect?.bottom ?? 0)
  })
  expect(opened).toBe(true)

  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (contents) =>
              contents.getURL().includes('extensionMenu.html') ||
              contents.getURL().startsWith('voyager://extension-menu')
          )
      )
    )
    .toBe(true)

  const menu = voyager.app
    .windows()
    .find(
      (page) =>
        page.url().includes('extensionMenu.html') ||
        page.url().startsWith('voyager://extension-menu')
    )
  expect(menu).toBeDefined()
  await expect(menu!.getByRole('heading', { name: 'Extensions' })).toBeVisible()
  await expect(menu!.getByText('Voyager E2E Password Filler')).toBeVisible()
  const icon = menu!.locator('[data-extension-row] img')
  await expect(icon).toHaveAttribute('src', /^data:image\/png;base64,/)
  expect(
    await icon.evaluate((element) => {
      const image = element as HTMLImageElement
      return image.complete && image.naturalWidth > 0
    })
  ).toBe(true)
  await expect(menu!.getByRole('button', { name: 'Pin extension' })).toBeVisible()
  await expect(
    menu!.getByRole('button', { name: 'More options for Voyager E2E Password Filler' })
  ).toBeVisible()
})

test('pins an extension to the toolbar and persists its site access', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string

  const pinned = await voyager.chrome.evaluate((extensionId) => {
    return window.voyager.extensions.setPinned(extensionId, true)
  }, id)
  expect(pinned[0]).toEqual(expect.objectContaining({ id, pinned: true }))
  await expect(
    voyager.chrome.getByRole('button', { name: 'Open Voyager E2E Password Filler' })
  ).toBeVisible()

  const access = await voyager.chrome.evaluate((extensionId) => {
    return window.voyager.extensions.setSiteAccess(extensionId, 'all')
  }, id)
  expect(access[0]).toEqual(expect.objectContaining({ id, siteAccess: 'all' }))
})

test('rejects Web Store URLs outside the Chrome Web Store', async ({ voyager }) => {
  await expect(
    voyager.chrome.evaluate(
      (url) => window.voyager.extensions.installFromStore(url),
      'https://example.com/detail/extension/abcdefghijklmnopabcdefghijklmnop'
    )
  ).rejects.toThrow('Only Chrome Web Store URLs are supported.')
})

test('lists installed extensions in the developer settings section', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: {
      settings: {
        developerMode: true,
        installedExtensions: [EXTENSION_PATH]
      }
    }
  })
  const settings = await openSettings(voyager)

  const section = settings.locator('[data-settings-section="extensions"]')
  await expect(section).toBeVisible()
  await expect(section).toContainText('Voyager E2E Password Filler')
  await expect(section).toContainText('Install .crx...')
  await expect(section.getByLabel('Chrome Web Store URL or extension id')).toBeVisible()
})
