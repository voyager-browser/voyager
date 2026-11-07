import { expect, test } from './fixtures'
import { interceptSearch, searchRequests } from './helpers/voyager'

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
