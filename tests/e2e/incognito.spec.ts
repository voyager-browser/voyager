import { expect, test } from './fixtures'
import { windowCount } from './helpers/voyager'

async function chromePages(app: import('@playwright/test').ElectronApplication) {
  return app
    .windows()
    .filter((page) => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()))
}

test('opens an incognito window with a visible badge', async ({ voyager }) => {
  const before = await windowCount(voyager.app)
  await voyager.chrome.evaluate(() => window.voyager.windows.openIncognito())
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)

  await expect
    .poll(async () => (await chromePages(voyager.app)).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2)

  const pages = await chromePages(voyager.app)
  const incognitoChrome = pages.find((page) => page !== voyager.chrome) ?? pages[1]
  const badge = incognitoChrome.getByText('Incognito', { exact: true })
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', 'You are in incognito mode')

  const state = await incognitoChrome.evaluate(() => window.voyager.windows.getState())
  expect(state.incognito).toBe(true)
})

test('opens an incognito window from the File menu', async ({ voyager }) => {
  test.skip(process.platform !== 'darwin', 'Uses application menu click path')
  const before = await windowCount(voyager.app)
  await voyager.app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File')
    file?.submenu?.items.find((item) => item.label === 'New Incognito Window')?.click()
  })
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)
})
