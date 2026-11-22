import { expect, test } from './fixtures'
import { openSettings, type VoyagerApp } from './helpers/voyager'

const BLOCKED_PIXEL = 'https://www.google-analytics.com/collect'

/** Load a blocked tracker request from a real tab so counters update. */
async function requestBlockedPixel(voyager: VoyagerApp, url: string): Promise<void> {
  await voyager.app.evaluate(
    async ({ webContents }, input) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === input.url)
      if (!contents) throw new Error('Tab WebContents not found')
      await contents.executeJavaScript(`
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve(true)
          image.onerror = () => resolve(true)
          image.src = ${JSON.stringify(input.pixel)}
          setTimeout(() => resolve(false), 3000)
        })
      `)
    },
    { url, pixel: BLOCKED_PIXEL }
  )
}

test('ad/tracker blocking is opt-in and persists when toggled', async ({ voyager }) => {
  const settings = await openSettings(voyager)

  const blocking = settings.getByLabel('Block ads and trackers')
  await expect(blocking).not.toBeChecked()
  await expect
    .poll(
      async () => (await settings.evaluate(() => window.voyager.settings.get())).contentBlocking
    )
    .toBe(false)

  await blocking.check()
  await expect
    .poll(
      async () => (await settings.evaluate(() => window.voyager.settings.get())).contentBlocking
    )
    .toBe(true)

  await blocking.uncheck()
  await expect
    .poll(
      async () => (await settings.evaluate(() => window.voyager.settings.get())).contentBlocking
    )
    .toBe(false)
})

test('selectable filter lists persist independently of the blocking toggle', async ({
  voyager
}) => {
  const settings = await openSettings(voyager)

  const stevenBlack = settings.getByRole('checkbox', { name: /StevenBlack Unified/ })
  await expect(stevenBlack).not.toBeChecked()

  await stevenBlack.check()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).filterLists)
    .toContain('stevenblack')

  await stevenBlack.uncheck()
  await expect
    .poll(async () => (await settings.evaluate(() => window.voyager.settings.get())).filterLists)
    .not.toContain('stevenblack')
})

test('page info reports blocked requests', async ({
  voyager,
  server
}) => {
  await voyager.chrome.evaluate(() => window.voyager.settings.set('contentBlocking', true))
  await voyager.navigate(server.url('/home'))
  await requestBlockedPixel(voyager, server.url('/home'))

  const stats = (): Promise<{ pageBlocked: number; siteEnabled: boolean }> =>
    voyager.chrome.evaluate(() => window.voyager.contentBlocking.getStats())

  await expect.poll(async () => (await stats()).pageBlocked).toBeGreaterThan(0)

  await voyager.chrome.getByRole('button', { name: 'View site information' }).click()
  await expect(voyager.chrome.getByText(/request.*blocked on this page/)).toBeVisible()
  await expect(voyager.chrome.getByText('www.google-analytics.com')).toBeVisible()
  await expect(voyager.chrome.getByText(/blocked this session/)).toBeVisible()

  const toggle = voyager.chrome.getByLabel('Block trackers on this site')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect.poll(async () => (await stats()).siteEnabled).toBe(false)
})
