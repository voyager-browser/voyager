import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { openSettings, type VoyagerApp } from './helpers/voyager'

const BLOCKED_PIXEL = 'https://www.google-analytics.com/collect'

/** Load a blocked tracker request from a real tab so counters update. */
async function requestBlockedPixel(
  voyager: VoyagerApp,
  url: string,
  pixel = BLOCKED_PIXEL
): Promise<void> {
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
    { url, pixel }
  )
}

async function addCustomFilterList(settings: Page, url: string): Promise<void> {
  await settings.getByLabel('Custom hosts list URL').fill(url)
  await settings.getByRole('button', { name: 'Add custom filter list' }).click()
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

test('applies a user-added remote list with a single domain', async ({ voyager, server }) => {
  const settings = await openSettings(voyager)
  await settings.getByLabel('Block ads and trackers').check()
  await settings.getByLabel('Voyager built-in list').uncheck()

  const listUrl = server.url('/custom-hosts.txt')
  await addCustomFilterList(settings, listUrl)
  await expect
    .poll(
      async () => (await settings.evaluate(() => window.voyager.settings.get())).customFilterLists
    )
    .toContain(listUrl)

  await voyager.navigate(server.url('/home'))
  const blockedPixel = server.url('/favicon.svg').replace('127.0.0.1', 'insecure.test')
  await expect
    .poll(async () => {
      await requestBlockedPixel(voyager, server.url('/home'), blockedPixel)
      return (await voyager.chrome.evaluate(() => window.voyager.contentBlocking.getStats()))
        .sessionBlocked
    })
    .toBeGreaterThan(0)
})

test('reports a custom remote list with no valid domains', async ({ voyager, server }) => {
  const settings = await openSettings(voyager)
  const listUrl = server.url('/empty-hosts.txt')

  await addCustomFilterList(settings, listUrl)

  await expect(settings.getByText(/No valid hosts entries were found/)).toBeVisible()
  await expect
    .poll(
      async () =>
        (await settings.evaluate(() => window.voyager.settings.get())).customFilterListErrors[
          listUrl
        ]
    )
    .toMatch(/No valid hosts entries/)
})

test('does not save an error for a custom list removed during download', async ({
  voyager,
  server
}) => {
  const settings = await openSettings(voyager)
  const listUrl = server.url('/slow-empty-hosts.txt')

  await addCustomFilterList(settings, listUrl)
  await expect.poll(() => server.hits('/slow-empty-hosts.txt')).toBeGreaterThan(0)

  await settings.getByRole('button', { name: `Remove custom filter list ${listUrl}` }).click()
  await expect(
    settings.getByRole('button', { name: `Remove custom filter list ${listUrl}` })
  ).toHaveCount(0)

  // The delayed failure arrives after removal; its error must not be restored.
  await settings.waitForTimeout(1_000)
  const settingsState = await settings.evaluate(() => window.voyager.settings.get())
  expect(settingsState.customFilterListErrors[listUrl]).toBeUndefined()
})

test('page info reports blocked requests', async ({ voyager, server }) => {
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
