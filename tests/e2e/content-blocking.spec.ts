import { expect, test } from './fixtures'
import { openSettings } from './helpers/voyager'

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
