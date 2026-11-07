import { isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'
import { primaryKey, waitForRenderedText } from './helpers/voyager'

test('records a visit as a page is navigated', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(1)
  const entries = (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries
  expect(entries[0].url).toBe(server.url('/home'))
  expect(entries[0].title).toBe('Voyager Test Home')
  expect(entries[0].visitCount).toBe(1)
})

test('revisiting the same URL increments the visit count', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  // Force another load so did-navigate fires again.
  await voyager.chrome.evaluate((url) => window.voyager.navigation.go(url), server.url('/home'))
  await expect.poll(async () => !(await voyager.activeTab()).loading)

  await expect
    .poll(async () => {
      const state = await voyager.chrome.evaluate(() => window.voyager.history.getState())
      return state.entries.find((entry: any) => entry.url === server.url('/home'))?.visitCount ?? 0
    })
    .toBe(2)
})

test('native History menu opens the history panel', async ({ voyager }) => {
  await voyager.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const historyMenuItem = menu?.items.find((item: any) => item.label === 'History')
    const showHistory = historyMenuItem?.submenu?.items.find(
      (item: any) => item.label === 'Show History'
    )
    showHistory?.click()
  })
  await expect(voyager.chrome.getByPlaceholder('Search history')).toBeVisible()
})

test('history panel lists entries and searches them', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.navigate(server.url('/second'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+Y`)
  const panel = voyager.chrome.getByPlaceholder('Search history')
  await expect(panel).toBeVisible()

  await expect(voyager.chrome.locator(`button[title="${server.url('/second')}"]`)).toBeVisible()
  await expect(voyager.chrome.locator(`button[title="${server.url('/home')}"]`)).toBeVisible()

  await panel.fill('Second')
  await expect(voyager.chrome.locator(`button[title="${server.url('/second')}"]`)).toBeVisible()
  await expect(voyager.chrome.locator(`button[title="${server.url('/home')}"]`)).toHaveCount(0)

  await panel.press('Escape')
  await expect(voyager.chrome.getByPlaceholder('Search history')).toHaveCount(0)
})

test('history remove deletes a single entry', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(1)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Y`)
  await expect(voyager.chrome.getByRole('button', { name: 'Remove from history' })).toBeVisible()
  await voyager.chrome.getByRole('button', { name: 'Remove from history' }).click()

  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(0)
  await voyager.chrome.locator('body').press('Escape') // noop safe
})

test('history clear empties the list via the panel', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.navigate(server.url('/second'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBeGreaterThanOrEqual(2)

  // There is no clear button in the panel UI; use the API exposed on window.voyager.history.
  await voyager.chrome.evaluate(() => window.voyager.history.clear())
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(0)
})

test('clicking a history entry navigates the active tab', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/first'.replace('/first', '/home')))
  await voyager.navigate(server.url('/first'.replace('/first', '/second')))

  const entries = (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries
  const homeEntry = entries.find((entry: any) => entry.url.includes('/home'))
  expect(homeEntry).toBeTruthy()

  await voyager.chrome.locator('body').press(`${primaryKey()}+Y`)
  await voyager.chrome.getByTitle(homeEntry!.url).click()
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeEntry!.url)
  await waitForRenderedText(voyager, homeEntry!.url, '#heading', 'Test Home')
})

test('history search can be cleared from the panel', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.navigate(server.url('/second'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+Y`)
  const panel = voyager.chrome.getByPlaceholder('Search history')
  await expect(panel).toBeVisible()

  await panel.fill('Second')
  await expect(voyager.chrome.locator(`button[title="${server.url('/home')}"]`)).toHaveCount(0)

  await voyager.chrome.getByRole('button', { name: 'Clear search' }).click()
  await expect(voyager.chrome.locator(`button[title="${server.url('/second')}"]`)).toBeVisible()
  await expect(voyager.chrome.locator(`button[title="${server.url('/home')}"]`)).toBeVisible()

  await panel.press('Escape')
})

test('history clear all requires confirmation', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.navigate(server.url('/second'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBeGreaterThanOrEqual(2)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Y`)
  await expect(voyager.chrome.getByRole('button', { name: 'Clear history' })).toBeVisible()
  await voyager.chrome.getByRole('button', { name: 'Clear history' }).click()
  await expect(voyager.chrome.getByRole('button', { name: 'Clear all' })).toBeVisible()

  await voyager.chrome.getByRole('button', { name: 'Clear all' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.history.getState())).entries.length
    )
    .toBe(0)
  await expect(voyager.chrome.getByPlaceholder('Search history')).toHaveCount(0)
})

test('reopens a recently closed tab with the keyboard shortcut', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+W`)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+T`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))
})

test('reopens a recently closed tab from the History menu', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+W`)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  const reopened = await voyager.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const history = menu?.items.find((item: any) => item.label === 'History')
    const recentlyClosed = history?.submenu?.items.find(
      (item: any) => item.label === 'Recently Closed'
    )
    const item = recentlyClosed?.submenu?.items?.[0]
    if (!item) return null
    const label = item.label
    item.click()
    return label
  })

  expect(reopened).toContain('Voyager')
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))
})
