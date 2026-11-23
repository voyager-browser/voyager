import { expect, test } from './fixtures'
import type { TestServer } from './helpers/server'
import { chromeBounds, type VoyagerApp } from './helpers/voyager'

test('renders a full-window vertical tab rail when enabled', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ seed: { settings: { verticalTabs: true } } })

  const rail = voyager.chrome.locator('aside[aria-label="Tabs"]')
  await expect(rail).toBeVisible()
  await expect(rail).toHaveCSS('width', '50px')
  await expect(rail.getByRole('tab')).toHaveCount(1)

  const [width, height] = await voyager.app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('No window')
    return window.getContentSize()
  })
  // Vertical mode keeps the chrome view full-window so the rail can run to the
  // bottom edge while the page sits to the right of it.
  expect(await chromeBounds(voyager)).toMatchObject({ x: 0, y: 0, width, height })

  await voyager.close()
})

test('toggles vertical tabs from the tab context menu', async ({ voyager }) => {
  await voyager.chrome.getByRole('tab').first().click({ button: 'right' })
  await voyager.chrome.getByRole('menuitem', { name: 'Show Tabs Vertically' }).click()

  const rail = voyager.chrome.locator('aside[aria-label="Tabs"]')
  await expect(rail).toBeVisible()
  await expect
    .poll(
      async () => (await voyager.chrome.evaluate(() => window.voyager.settings.get())).verticalTabs
    )
    .toBe(true)

  await rail.getByRole('tab').first().click({ button: 'right' })
  await voyager.chrome.getByRole('menuitem', { name: 'Show Tabs Horizontally' }).click()

  await expect(rail).toHaveCount(0)
  await expect
    .poll(
      async () => (await voyager.chrome.evaluate(() => window.voyager.settings.get())).verticalTabs
    )
    .toBe(false)
})

test('opens the main menu directly below its toolbar button', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ seed: { settings: { verticalTabs: true } } })
  const button = voyager.chrome.getByRole('button', { name: 'Menu' })
  const buttonBox = await button.boundingBox()
  if (!buttonBox) throw new Error('Menu button has no bounding box')

  await button.click()

  const menu = voyager.chrome.getByRole('menu', { name: 'Browser menu' })
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  if (!menuBox) throw new Error('Main menu has no bounding box')

  expect(Math.abs(menuBox.y - (buttonBox.y + buttonBox.height))).toBeLessThanOrEqual(1)
  expect(Math.abs(menuBox.x + menuBox.width - (buttonBox.x + buttonBox.width))).toBeLessThanOrEqual(
    1
  )

  await voyager.close()
})

/** URLs of the content views in stacking order; the last entry is topmost. */
async function viewStack(voyager: VoyagerApp): Promise<string[]> {
  return voyager.app.evaluate(({ BaseWindow, WebContentsView }) => {
    const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('No window')
    return window.contentView.children
      .filter((view) => view instanceof WebContentsView)
      .map((view) => view.webContents.getURL())
  })
}

/** Both panes must sit above the transparent chrome whose bounds cover them. */
async function expectPanesAboveChrome(
  voyager: VoyagerApp,
  primaryUrl: string,
  secondaryUrl: string
): Promise<void> {
  await expect
    .poll(async () => {
      const stack = await viewStack(voyager)
      const chrome = stack.findIndex((url) => url.startsWith('file:'))
      return (
        chrome >= 0 && stack.indexOf(primaryUrl) > chrome && stack.indexOf(secondaryUrl) > chrome
      )
    })
    .toBe(true)
}

/** Open a split view with two distinct, loaded pages. */
async function openSplitView(
  voyager: VoyagerApp,
  server: TestServer
): Promise<{ primaryUrl: string; secondaryUrl: string }> {
  const primaryUrl = server.url('/home')
  const secondaryUrl = server.url('/second')
  await voyager.navigate(primaryUrl, primaryUrl)
  const primary = await voyager.activeTab()
  const secondaryId = await voyager.chrome.evaluate(
    (url) => window.voyager.tabs.create({ url }),
    secondaryUrl
  )
  await voyager.waitForTab((tab) => tab.id === secondaryId && tab.url === secondaryUrl)
  await voyager.chrome.evaluate((id) => window.voyager.tabs.activate(id), primary.id)
  await voyager.chrome.evaluate(
    ({ first, second }) => window.voyager.tabs.openSplit(first, second),
    { first: primary.id, second: secondaryId }
  )
  await expect.poll(async () => (await voyager.state()).splitTabId).toBe(secondaryId)
  return { primaryUrl, secondaryUrl }
}

test('raises both split panes above chrome in vertical tabs mode', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({ seed: { settings: { verticalTabs: true } } })
  const { primaryUrl, secondaryUrl } = await openSplitView(voyager, server)
  await expectPanesAboveChrome(voyager, primaryUrl, secondaryUrl)

  // Overlays and rail expansion put chrome on top temporarily. Closing them
  // must raise both panes again, not just the active one.
  await voyager.chrome.evaluate(() => window.voyager.ui.setOverlayOpen(true))
  await voyager.chrome.evaluate(() => window.voyager.ui.setOverlayOpen(false))
  await expectPanesAboveChrome(voyager, primaryUrl, secondaryUrl)

  await voyager.chrome.evaluate(() => window.voyager.ui.setRailExpanded(true))
  await voyager.chrome.evaluate(() => window.voyager.ui.setRailExpanded(false))
  await expectPanesAboveChrome(voyager, primaryUrl, secondaryUrl)

  await voyager.close()
})

test('raises the secondary pane when vertical tabs are enabled in split view', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager()
  const { primaryUrl, secondaryUrl } = await openSplitView(voyager, server)
  await expectPanesAboveChrome(voyager, primaryUrl, secondaryUrl)

  await voyager.chrome.evaluate(() => window.voyager.settings.set('verticalTabs', true))
  await expect
    .poll(
      async () => (await voyager.chrome.evaluate(() => window.voyager.settings.get())).verticalTabs
    )
    .toBe(true)
  await expectPanesAboveChrome(voyager, primaryUrl, secondaryUrl)

  const [width, height] = await voyager.app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('No window')
    return window.getContentSize()
  })
  expect(await chromeBounds(voyager)).toMatchObject({ x: 0, y: 0, width, height })

  await voyager.close()
})
