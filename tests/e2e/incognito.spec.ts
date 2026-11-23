import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures'
import { pollUntil, windowCount } from './helpers/voyager'

async function chromePages(app: ElectronApplication) {
  return app
    .windows()
    .filter((page) => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()))
}

async function chromePageForProfile(
  app: ElectronApplication,
  profileId: string,
  incognito: boolean
) {
  return pollUntil(async () => {
    for (const page of await chromePages(app)) {
      try {
        const state = await page.evaluate(() => window.voyager?.windows?.getState())
        if (state?.profile.id === profileId && state.incognito === incognito) return page
      } catch {
        // The renderer may not have exposed the bridge yet.
      }
    }
    return undefined
  })
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

test('incognito tabs use the user agent of the profile that opened them', async ({
  voyager,
  server
}) => {
  const defaultUA = 'Mozilla/5.0 (X11; Linux x86_64) VoyagerDefault/1.0'
  const workUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoyagerWork/1.0'
  await voyager.chrome.evaluate((ua) => window.voyager.settings.set('userAgent', ua), defaultUA)

  const profile = await voyager.chrome.evaluate(() =>
    window.voyager.profiles.create({ name: 'Work' })
  )
  await voyager.chrome.evaluate((id) => window.voyager.profiles.openWindow(id), profile.id)
  const workChrome = await chromePageForProfile(voyager.app, profile.id, false)
  await workChrome.evaluate((ua) => window.voyager.settings.set('userAgent', ua), workUA)

  // The named profile's normal tabs are the control: they must show its UA.
  // Create the tab after setting the preference because the tab preload reads
  // the profile UA once, when its WebContents is created.
  await workChrome.evaluate((url) => window.voyager.tabs.create({ url }), server.url('/home'))
  const workTab = await voyager.tabPage('/home')
  await expect.poll(() => workTab.evaluate(() => navigator.userAgent)).toBe(workUA)

  await workChrome.evaluate(
    (url) => window.voyager.windows.openIncognito(url),
    server.url('/second')
  )
  const incognitoChrome = await chromePageForProfile(voyager.app, profile.id, true)
  const incognitoState = await incognitoChrome.evaluate(() => window.voyager.windows.getState())
  expect(incognitoState.incognito).toBe(true)
  expect(incognitoState.profile.id).toBe(profile.id)

  const incognitoTab = await voyager.tabPage('/second')
  await expect.poll(() => incognitoTab.evaluate(() => navigator.userAgent)).toBe(workUA)
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
