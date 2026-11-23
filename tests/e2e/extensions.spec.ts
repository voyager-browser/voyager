import { join } from 'node:path'
import { expect, test } from './fixtures'
import { openSettings, windowCount, type VoyagerApp } from './helpers/voyager'

const EXTENSIONS_DIR = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'extensions')
const EXTENSION_PATH = join(EXTENSIONS_DIR, 'password-filler')
const CRX_PATH = join(EXTENSIONS_DIR, 'password-filler.crx')
const NATIVE_HOST_PATH = join(EXTENSION_PATH, 'nativeHost.js')

/** Bottom-right corner of a toolbar button, in window coordinates. */
async function buttonAnchor(voyager: VoyagerApp, label: string): Promise<{ x: number; y: number }> {
  return voyager.chrome.evaluate((name) => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === name
    )
    const rect = button?.getBoundingClientRect()
    return { x: rect?.right ?? 0, y: rect?.bottom ?? 0 }
  }, label)
}

/** Bounds of the in-window child view whose URL starts with `prefix`. */
async function panelBounds(
  voyager: VoyagerApp,
  prefix: string
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return voyager.app.evaluate(({ webContents, BaseWindow }, urlPrefix) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith(urlPrefix))
    if (!contents) return null
    for (const window of BaseWindow.getAllWindows()) {
      const view = window.contentView.children.find(
        (child) => (child as unknown as { webContents?: unknown }).webContents === contents
      )
      if (view) return view.getBounds()
    }
    return null
  }, prefix)
}

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

test('opens a Voyager tab when an extension calls chrome.tabs.create', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Open tab' }).click()

  // Activating the new tab dismisses the action popup, just as Chrome does, so
  // assert the resulting Voyager tab rather than the popup's own DOM.
  await expect
    .poll(async () =>
      (await voyager.state()).tabs.some((tab) => tab.url.startsWith('https://example.test/'))
    )
    .toBe(true)
})

test('prompts before granting a new extension permission', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Request privacy access' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toContainText('Change your privacy-related settings')
  await prompt.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(prompt).toHaveCount(0)

  // The extension page stays alive while the chrome prompt is answered, so the
  // permission callback can report the persisted decision.
  await expect(popup!.locator('#permission-result')).toHaveText('permission granted')
})

test('exchanges native messages between an extension and a native host', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()

  await voyager.chrome.evaluate(
    ({ extensionId, hostPath }) =>
      window.voyager.extensions.setNativeHosts([
        {
          name: 'com.voyager.e2e',
          path: hostPath,
          allowedOrigins: [`chrome-extension://${extensionId}/`]
        }
      ]),
    { extensionId: id, hostPath: NATIVE_HOST_PATH }
  )

  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)
  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))

  await popup!.getByRole('button', { name: 'Send native message' }).click()
  await expect(popup!.locator('#native-result')).toHaveText('one-shot')

  await popup!.getByRole('button', { name: 'Connect native port' }).click()
  await expect(popup!.locator('#native-port-result')).toHaveText('port')
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

test('opens a popup when an extension row in the HTML menu is clicked', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const puzzleAnchor = await buttonAnchor(voyager, 'Extensions')
  await voyager.chrome.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Extensions'
    )
    const rect = button?.getBoundingClientRect()
    return window.voyager.extensions.showActionMenu(rect?.right ?? 0, rect?.bottom ?? 0)
  })

  const isMenuPage = (url: string): boolean =>
    url.includes('extensionMenu.html') || url.startsWith('voyager://extension-menu')
  await expect.poll(() => voyager.app.windows().some((page) => isMenuPage(page.url()))).toBe(true)
  const menu = voyager.app.windows().find((page) => isMenuPage(page.url()))
  const row = menu!.getByRole('button', { name: 'Voyager E2E Password Filler', exact: true })
  await expect(row).toBeVisible()
  await row.click()

  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) => contents.getURL().startsWith('chrome-extension://'))
      )
    )
    .toBe(true)
  const popupText = await voyager.app.evaluate(({ webContents }) => {
    const popup = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('chrome-extension://'))
    return popup?.executeJavaScript(
      "document.querySelector('#voyager-extension-popup')?.textContent ?? ''"
    )
  })
  expect(popupText).toBe('password-filler-popup')

  // The popup should still appear to come from the puzzle button, not the row
  // that was clicked inside the HTML menu.
  const bounds = await panelBounds(voyager, 'chrome-extension://')
  expect(bounds).not.toBeNull()
  expect(Math.abs(bounds!.x + bounds!.width - puzzleAnchor.x)).toBeLessThan(3)
  expect(Math.abs(bounds!.y - (puzzleAnchor.y + 8))).toBeLessThan(3)
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

  const pinAnchor = await buttonAnchor(voyager, 'Open Voyager E2E Password Filler')
  await voyager.chrome.getByRole('button', { name: 'Open Voyager E2E Password Filler' }).click()
  await expect.poll(() => panelBounds(voyager, 'chrome-extension://')).not.toBeNull()
  const popupBounds = await panelBounds(voyager, 'chrome-extension://')
  expect(popupBounds).not.toBeNull()
  expect(Math.abs(popupBounds!.x + popupBounds!.width - pinAnchor.x)).toBeLessThan(3)
  expect(Math.abs(popupBounds!.y - (pinAnchor.y + 8))).toBeLessThan(3)

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
