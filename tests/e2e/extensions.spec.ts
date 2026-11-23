import { join } from 'node:path'
import { expect, test } from './fixtures'
import { openSettings } from './helpers/voyager'

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

test('opens an extension action popup from the toolbar', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const popupPromise = voyager.app.waitForEvent('window', {
    predicate: (page) => page.url().startsWith('chrome-extension://'),
    timeout: 15_000
  })

  await voyager.chrome.getByRole('button', { name: 'Extensions' }).click()
  await voyager.chrome.getByRole('menuitem', { name: 'Voyager E2E Password Filler' }).click()
  const popup = await popupPromise
  await expect(popup.locator('#voyager-extension-popup')).toHaveText('password-filler-popup')

  // Electron omits chrome.webNavigation; extensions that register navigation
  // listeners at startup crash without this compatibility layer.
  const navigation = await popup.evaluate(() => {
    const api = (globalThis as any).chrome?.webNavigation
    const listener = (): void => undefined
    api?.onCommitted?.addListener(listener)
    const hasListener = api?.onCommitted?.hasListener(listener) ?? false
    api?.onCommitted?.removeListener(listener)
    return { present: Boolean(api), hasListener }
  })
  expect(navigation).toEqual({ present: true, hasListener: true })
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
