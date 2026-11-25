import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { pollUntil, windowCount } from './helpers/voyager'

function chromePages(app: ElectronApplication): Page[] {
  return app
    .windows()
    .filter((page) => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()))
}

test('app menu follows the focused window after a tab closes in a different window', async ({
  voyager,
  server
}) => {
  const homeUrl = server.url('/home')
  const secondUrl = server.url('/second')

  await voyager.navigate(homeUrl)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  // The new window becomes active as soon as it is registered.
  await voyager.chrome.evaluate((url) => window.voyager.windows.open(url), secondUrl)
  await expect.poll(async () => windowCount(voyager.app)).toBe(2)
  const secondChrome = await pollUntil(() =>
    chromePages(voyager.app).find((page) => page !== voyager.chrome)
  )
  await secondChrome.bringToFront()
  await expect
    .poll(async () =>
      secondChrome.evaluate(async () => (await window.voyager.tabs.getState()).tabs[0]?.url)
    )
    .toBe(secondUrl)

  // Close a tab in the first window without focusing it. This refresh used to
  // pin the shared application menu to that window for the rest of the session.
  await voyager.chrome.evaluate(async () => {
    const id = await window.voyager.tabs.create({ active: false })
    await window.voyager.tabs.close(id)
  })
  // Re-focus B so the menu lookup must resolve to B, not whichever window the
  // tab-close IPC happened to touch.
  await secondChrome.bringToFront()

  const homeHits = server.hits('/home')
  const secondHits = server.hits('/second')
  const clicked = await voyager.app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')
    const reload = view?.submenu?.items.find((item) => item.label === 'Reload')
    reload?.click()
    return Boolean(reload)
  })
  expect(clicked).toBe(true)

  await expect.poll(() => server.hits('/second')).toBeGreaterThan(secondHits)
  await expect.poll(() => server.hits('/home')).toBe(homeHits)
})

test('app menu state follows the focused window profile', async ({ voyager }) => {
  const profileB = await voyager.chrome.evaluate(() =>
    window.voyager.profiles.create({ name: 'Menu Focus B' })
  )
  await voyager.chrome.evaluate((id) => window.voyager.profiles.openWindow(id), profileB.id)
  await expect.poll(async () => windowCount(voyager.app)).toBe(2)
  const secondChrome = await pollUntil(() =>
    chromePages(voyager.app).find((page) => page !== voyager.chrome)
  )
  await secondChrome.bringToFront()

  const menuState = (): Promise<{ developerMode: boolean | undefined; forDevelopers: boolean }> =>
    voyager.app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')?.submenu
      return {
        developerMode: view?.items.find((item) => item.label === 'Developer Mode')?.checked,
        forDevelopers: view?.items.some((item) => item.label === 'For Developers') ?? false
      }
    })

  // Change B while it is focused: its state becomes the menu's snapshot.
  await secondChrome.evaluate(async () => {
    await window.voyager.settings.set('developerMode', true)
  })
  await expect.poll(async () => (await menuState()).developerMode).toBe(true)
  expect((await menuState()).forDevelopers).toBe(true)

  // Focusing A must replace that snapshot, including the developer submenu.
  await voyager.chrome.bringToFront()
  await expect.poll(async () => (await menuState()).developerMode).toBe(false)
  expect((await menuState()).forDevelopers).toBe(false)

  // Flip A's state, then focus B again: neither profile's old state may linger.
  await voyager.chrome.evaluate(async () => {
    await window.voyager.settings.set('developerMode', true)
  })
  await expect.poll(async () => (await menuState()).developerMode).toBe(true)
  await secondChrome.bringToFront()
  await expect.poll(async () => (await menuState()).developerMode).toBe(false)
  expect((await menuState()).forDevelopers).toBe(false)
})
