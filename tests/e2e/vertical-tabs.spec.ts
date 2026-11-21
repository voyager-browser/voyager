import { expect, test } from './fixtures'
import { chromeBounds } from './helpers/voyager'

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
