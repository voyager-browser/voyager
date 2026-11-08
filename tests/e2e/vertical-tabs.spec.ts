import { expect, test } from './fixtures'
import { chromeBounds } from './helpers/voyager'

test('renders a full-window vertical tab rail when enabled', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ seed: { settings: { verticalTabs: true } } })

  const rail = voyager.chrome.locator('aside[aria-label="Tabs"]')
  await expect(rail).toBeVisible()
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
  await voyager.chrome.getByRole('menuitem', { name: 'Turn on vertical tabs' }).click()

  const rail = voyager.chrome.locator('aside[aria-label="Tabs"]')
  await expect(rail).toBeVisible()
  await expect
    .poll(
      async () => (await voyager.chrome.evaluate(() => window.voyager.settings.get())).verticalTabs
    )
    .toBe(true)

  await rail.getByRole('tab').first().click({ button: 'right' })
  await voyager.chrome.getByRole('menuitem', { name: 'Turn off vertical tabs' }).click()

  await expect(rail).toHaveCount(0)
  await expect
    .poll(
      async () => (await voyager.chrome.evaluate(() => window.voyager.settings.get())).verticalTabs
    )
    .toBe(false)
})
