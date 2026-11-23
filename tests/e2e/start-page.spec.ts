import { isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'
import { interceptSearch, searchRequests } from './helpers/voyager'

test('new-tab detection covers internal URLs without matching external pages', () => {
  // Production (and local production builds) use the custom protocol.
  expect(isNewTab('voyager://start')).toBe(true)
  expect(isNewTab('voyager://start?engine=duckduckgo')).toBe(true)
  expect(isNewTab('voyager://start#section')).toBe(true)
  expect(isNewTab('voyager://start/')).toBe(true)

  // Development uses the electron-vite loopback dev server.
  expect(isNewTab('http://localhost:5173/start.html?engine=duckduckgo')).toBe(true)
  expect(isNewTab('http://127.0.0.1:5173/start.html')).toBe(true)
  expect(isNewTab('http://[::1]:5173/start.html')).toBe(true)

  // External sites and files must never be treated as the internal start page.
  expect(isNewTab('https://example.com/start.html')).toBe(false)
  expect(isNewTab('http://localhost.evil.example/start.html')).toBe(false)
  expect(isNewTab('file:///start.html')).toBe(false)
  expect(isNewTab('http://localhost:5173/other.html')).toBe(false)
})

test('start page searches with the configured engine', async ({ voyager, server }) => {
  await interceptSearch(voyager, server)

  const input = voyager.tab.locator('#start-search')
  await expect(input).toBeVisible()
  await expect(input).toHaveAttribute('placeholder', 'Search with DuckDuckGo')

  await input.fill('voyager browser')
  await input.press('Enter')

  await expect
    .poll(async () => (await voyager.activeTab()).url)
    .toBe(`${server.url('/search')}?q=voyager%20browser`)
  await expect(voyager.tab.locator('#query')).toHaveText('voyager browser')
  expect(await searchRequests(voyager.app)).toHaveLength(1)
})

test('start page follows the persisted search engine', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ seed: { settings: { searchEngine: 'brave' } } })
  try {
    await expect(voyager.tab.locator('#start-search')).toHaveAttribute(
      'placeholder',
      'Search with Brave Search'
    )
    expect(voyager.tab.url()).toContain('engine=brave')
  } finally {
    await voyager.close()
  }
})

test('a malformed persisted search engine falls back without crashing the omnibox', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({ seed: { settings: { searchEngine: 'toString' } } })
  try {
    await interceptSearch(voyager, server)
    await expect(voyager.tab.locator('#start-search')).toHaveAttribute(
      'placeholder',
      'Search with DuckDuckGo'
    )

    const input = voyager.chrome.locator('#omnibox-input')
    await input.fill('voyager browser')
    await input.press('Enter')

    await voyager.waitForTab(
      (tab) => tab.url === server.url('/search?q=voyager%20browser') && !tab.loading
    )
    expect(await searchRequests(voyager.app)).toContain(
      'https://duckduckgo.com/?q=voyager%20browser'
    )
  } finally {
    await voyager.close()
  }
})

test('start page marks incognito windows', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ seed: { settings: { incognito: true } } })
  try {
    await expect(voyager.tab.getByText('Incognito')).toBeVisible()
    await expect(voyager.tab.locator('#start-search')).toHaveAttribute(
      'placeholder',
      'Search with DuckDuckGo'
    )
    expect(voyager.tab.url()).toContain('incognito=1')
  } finally {
    await voyager.close()
  }
})
