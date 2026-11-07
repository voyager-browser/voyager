import { isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'
import { pressPageShortcut, primaryKey } from './helpers/voyager'

test('page-level shortcuts create, close and reopen tabs', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  const url = server.url('/home')
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(url)

  const count0 = (await voyager.state()).tabs.length
  await pressPageShortcut(voyager, 't', ['meta'])
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(count0 + 1)
  expect(isNewTab((await voyager.activeTab()).url)).toBe(true)

  await pressPageShortcut(voyager, 'w', ['meta'])
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(count0)
  expect((await voyager.activeTab()).url).toBe(url)

  await pressPageShortcut(voyager, 't', ['meta', 'shift'])
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(count0 + 1)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)
})

test('page-level tab navigation shortcuts', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  const homeUrl = server.url('/home')
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await pressPageShortcut(voyager, 't', ['meta'])
  await voyager.navigate(server.url('/second'))
  const secondUrl = server.url('/second')
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)

  await pressPageShortcut(voyager, '[', ['meta', 'shift'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await pressPageShortcut(voyager, ']', ['meta', 'shift'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)

  await pressPageShortcut(voyager, '1', ['meta'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await pressPageShortcut(voyager, '9', ['meta'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)
})

test('page-level back and forward shortcuts', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.navigate(server.url('/second'))
  const secondUrl = server.url('/second')
  const homeUrl = server.url('/home')

  await pressPageShortcut(voyager, '[', ['meta'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await pressPageShortcut(voyager, ']', ['meta'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)

  // Alt+ArrowLeft / Alt+ArrowRight
  await pressPageShortcut(voyager, 'ArrowLeft', ['alt'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await pressPageShortcut(voyager, 'ArrowRight', ['alt'])
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)
})

test('page-level reload and force-reload shortcuts', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/count'))
  const countUrl = server.url('/count')
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(countUrl)
  await expect.poll(async () => !(await voyager.activeTab()).loading)
  const countBefore = Number(await voyager.tab.locator('#hits').textContent())

  await pressPageShortcut(voyager, 'r', ['meta'])
  await expect.poll(async () => !(await voyager.activeTab()).loading)
  await expect
    .poll(async () => Number(await voyager.tab.locator('#hits').textContent()))
    .toBeGreaterThan(countBefore)
})

test('page-level find-in-page shortcut opens the find bar', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/find'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/find'))
  await pressPageShortcut(voyager, 'f', ['meta'])
  await expect(voyager.chrome.locator('input[placeholder="Find in page"]')).toBeVisible()
  // Escape closes it.
  await voyager.chrome.locator('input[placeholder="Find in page"]').press('Escape')
  await expect(voyager.chrome.locator('input[placeholder="Find in page"]')).toHaveCount(0)
})

test('page-level tab-search shortcut opens the palette', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await pressPageShortcut(voyager, 'a', ['meta', 'shift'])
  await expect(voyager.chrome.getByPlaceholder('Search tabs')).toBeVisible()
  await voyager.chrome.getByPlaceholder('Search tabs').press('Escape')
  await expect(voyager.chrome.getByPlaceholder('Search tabs')).toHaveCount(0)
})

test('page-level history and downloads shortcuts open overlays', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await pressPageShortcut(voyager, 'y', ['meta'])
  await expect(voyager.chrome.getByPlaceholder('Search history')).toBeVisible()
  await voyager.chrome.getByPlaceholder('Search history').press('Escape')
  await expect(voyager.chrome.getByPlaceholder('Search history')).toHaveCount(0)

  await pressPageShortcut(voyager, 'j', ['meta', 'shift'])
  await expect(voyager.chrome.getByPlaceholder('Search downloads')).toBeVisible()
  await voyager.chrome.getByPlaceholder('Search downloads').press('Escape')
  await expect(voyager.chrome.getByPlaceholder('Search downloads')).toHaveCount(0)
})

test('page-level bookmark-bar toggle shortcut changes visibility', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  const stateBefore = (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState()))
    .barVisible

  await pressPageShortcut(voyager, 'b', ['meta', 'shift'])
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(!stateBefore)

  // Restore.
  await pressPageShortcut(voyager, 'b', ['meta', 'shift'])
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(stateBefore)
})

test('chrome-level tab shortcuts on new/close/reload etc.', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  // Create a new blank tab and focus the omnibox with Cmd+L.
  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.chrome.locator('body').press(`${primaryKey()}+L`)
  await expect(voyager.chrome.locator('#omnibox-input')).toBeFocused()
})

test('focusing the omnibox selects all text (chrome-level Meta+L)', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.chrome.locator('#omnibox-input').blur?.()
  await voyager.chrome.locator('body').press(`${primaryKey()}+L`)
  const input = voyager.chrome.locator('#omnibox-input')
  await expect(input).toBeFocused()
  const selectionEnd = await input.evaluate((el) => (el as HTMLInputElement).selectionEnd)
  expect(selectionEnd).toBe((await voyager.state()).tabs[0].url.length)
})
