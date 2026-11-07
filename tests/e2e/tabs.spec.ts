import { isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'
import { primaryKey, waitForRenderedText } from './helpers/voyager'

async function vyWait(voyager: any, url: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const tab = await voyager.activeTab()
      if (tab.url === url && !tab.loading) return
    } catch {
      // Retry until the main process state is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

test('creates new tabs and activates the latest one', async ({ voyager }) => {
  const tabsBefore = (await voyager.state()).tabs.length

  await voyager.chrome.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(tabsBefore + 1)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(tabsBefore + 2)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)
})

test('shows separators between adjacent inactive horizontal tabs', async ({ voyager }) => {
  const separators = voyager.chrome.getByTestId('tab-separator')
  await expect(separators).toHaveCount(0)

  for (let count = 1; count <= 3; count += 1) {
    await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
    await expect.poll(async () => (await voyager.state()).tabs.length).toBe(count + 1)
  }

  // The newest tab is active, so only the two separators between the three
  // inactive tabs are rendered.
  await expect(separators).toHaveCount(2)

  const tabIds = (await voyager.state()).tabs.map((tab) => tab.id)

  await voyager.chrome.locator('body').press(`${primaryKey()}+2`)
  await expect.poll(async () => (await voyager.state()).activeTabId).toBe(tabIds[1])
  await expect(separators).toHaveCount(1)

  await voyager.chrome.locator('body').press(`${primaryKey()}+1`)
  await expect.poll(async () => (await voyager.state()).activeTabId).toBe(tabIds[0])
  await expect(separators).toHaveCount(2)
})

test('closes tabs and recovers by reopening the last one', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))
  const homeUrl = server.url('/home')

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(2)

  await voyager.chrome.locator('body').press(`${primaryKey()}+W`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(1)
  expect((await voyager.activeTab()).url).toBe(homeUrl)

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(2)

  await voyager.chrome.locator('body').press(`${primaryKey()}+1`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)
  await voyager.chrome.getByRole('button', { name: 'Close Voyager Test Home' }).click()
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(1)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(2)
  await vyWait(voyager, homeUrl)
  await waitForRenderedText(voyager, homeUrl, '#heading', 'Test Home')
})

test('switches tabs with keyboard shortcuts', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))
  const homeUrl = server.url('/home')

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await voyager.navigate(server.url('/second'))
  await vyWait(voyager, server.url('/second'))
  const secondUrl = server.url('/second')

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+[`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+]`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)

  await voyager.chrome.locator('body').press(`${primaryKey()}+1`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(homeUrl)

  await voyager.chrome.locator('body').press(`${primaryKey()}+2`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)

  await voyager.chrome.locator('body').press(`${primaryKey()}+9`)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(secondUrl)
})

test('duplicates, pins, mutes and copies a tab via the tab API', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))
  const tabsBefore = (await voyager.state()).tabs.length

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    if (state.activeTabId) await window.voyager.tabs.duplicate(state.activeTabId)
  })
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(tabsBefore + 1)

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    if (state.activeTabId) await window.voyager.tabs.pinToggle(state.activeTabId)
  })
  await expect.poll(async () => (await voyager.activeTab()).pinned).toBe(true)
  expect((await voyager.state()).tabs[0].pinned).toBe(true)

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    if (state.activeTabId) await window.voyager.tabs.muteToggle(state.activeTabId)
  })
  await expect.poll(async () => (await voyager.activeTab()).muted).toBe(true)

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    if (state.activeTabId) await window.voyager.tabs.muteToggle(state.activeTabId)
  })
  await expect.poll(async () => (await voyager.activeTab()).muted).toBe(false)

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    if (state.activeTabId) await window.voyager.tabs.pinToggle(state.activeTabId)
  })
  await expect.poll(async () => (await voyager.activeTab()).pinned).toBe(false)
  const copied = await voyager.chrome.evaluate(async (homeUrl) => {
    const state = await window.voyager.tabs.getState()
    const tab = state.tabs.find((item: any) => item.url === homeUrl)
    if (!tab) return undefined
    return await window.voyager.tabs.copyUrl(tab.id)
  }, server.url('/home'))
  expect(copied).toBe(server.url('/home'))
})

test('closes other and right-hand tabs via the tab API', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await voyager.navigate(server.url('/second'))
  await vyWait(voyager, server.url('/second'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(3)

  const firstState = (await voyager.state()).tabs
  const homeTabId = firstState.find((tab: any) => tab.url === server.url('/home'))!.id

  await voyager.chrome.evaluate(async (id) => {
    await window.voyager.tabs.activate(id)
    await window.voyager.tabs.closeOthers(id)
  }, homeTabId)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(1)
  expect((await voyager.activeTab()).url).toBe(server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+T`)
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(2)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.tabs.getState()
    const tab = state.tabs.find((item: any) => item.url.includes('/home'))
    if (tab) {
      await window.voyager.tabs.activate(tab.id)
      await window.voyager.tabs.closeToRight(tab.id)
    }
  })
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(1)
})

test('tab search palette filters and activates tabs', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await voyager.navigate(server.url('/second'))
  await vyWait(voyager, server.url('/second'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+A`)
  const paInput = voyager.chrome.getByPlaceholder('Search tabs')
  await expect(paInput).toBeVisible()

  await paInput.fill('Second')
  await expect(
    voyager.chrome.locator('div.fixed.inset-0.z-40 button', { hasText: 'Second Page' })
  ).toBeVisible()

  await paInput.press('ArrowDown')
  await paInput.press('Enter')
  await expect.poll(async () => (await voyager.activeTab()).title).toBe('Second Page')
  await expect(voyager.chrome.getByPlaceholder('Search tabs')).toHaveCount(0)

  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+A`)
  await voyager.chrome.getByPlaceholder('Search tabs').fill('zzz-no-match')
  await expect(voyager.chrome.getByText('No matching tabs')).toBeVisible()
  await voyager.chrome.getByPlaceholder('Search tabs').press('Escape')
  await expect(voyager.chrome.getByPlaceholder('Search tabs')).toHaveCount(0)
})

test('opening a link with target=_blank becomes a new tab', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await vyWait(voyager, server.url('/home'))

  const tabsBefore = (await voyager.state()).tabs.length
  await voyager.tab.getByRole('link', { name: 'Open popup' }).click()
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(tabsBefore + 1)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/popup'))
  const popupTab = await voyager.tabPage(server.url('/popup'))
  await expect(popupTab.locator('#heading')).toHaveText('Popup Page')
})

test('reloads the active tab when requested', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/count'))
  await vyWait(voyager, server.url('/count'))
  const countBefore = Number(await voyager.tab.locator('#hits').textContent())

  await voyager.chrome.evaluate(() => window.voyager.navigation.reload())
  await expect.poll(async () => !(await voyager.activeTab()).loading)
  await expect
    .poll(async () => Number(await voyager.tab.locator('#hits').textContent()))
    .toBeGreaterThan(countBefore)
})
