import { matchShortcut } from '../../src/shared/keyboard'
import { displayUrl, isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'
import { interceptSearch, pressPageShortcut, searchRequests } from './helpers/voyager'

test('condenses the scheme, www prefix and site-root slash', () => {
  expect(displayUrl('https://www.example.com/')).toBe('example.com')
  expect(displayUrl('https://www.example.com/path?q=1#top')).toBe('example.com/path?q=1#top')
  expect(displayUrl('http://localhost:4321/')).toBe('localhost:4321')
  expect(displayUrl('about:blank')).toBe('')
  expect(displayUrl('voyager://start?engine=duckduckgo')).toBe('')
})

test('shows a condensed active URL and clears it for a new tab', async ({ voyager, server }) => {
  const input = voyager.chrome.locator('#omnibox-input')
  await voyager.navigate(server.url('/home'))
  await expect(input).toHaveValue(displayUrl(server.url('/home')))

  await voyager.chrome.getByRole('button', { name: 'New tab', exact: true }).click()
  await voyager.waitForTab((tab) => isNewTab(tab.url))
  await expect(input).toHaveValue('')
})

test('keeps every character typed after opening a new tab', async ({ voyager }) => {
  await voyager.chrome.getByRole('button', { name: 'New tab', exact: true }).click()
  await voyager.waitForTab((tab) => isNewTab(tab.url))

  const input = voyager.chrome.locator('#omnibox-input')
  await expect(input).toBeFocused()
  await input.pressSequentially('ex')
  await expect(input).toHaveValue('ex')
})

test('selects the whole address when focused', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  const input = voyager.chrome.locator('#omnibox-input')
  await input.focus()
  await expect(input).toHaveValue(server.url('/home'))

  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length }
  })

  expect(selection.start).toBe(0)
  expect(selection.end).toBe(selection.length)
  expect(selection.length).toBeGreaterThan(0)
})

test('Alt+D focuses the address bar and selects it', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await voyager.chrome.locator('body').press('Alt+d')

  const input = voyager.chrome.locator('#omnibox-input')
  await expect(input).toBeFocused()
  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length }
  })
  expect(selection.start).toBe(0)
  expect(selection.end).toBe(selection.length)
})

test('Alt+D hands keyboard focus from the page to the address bar', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await pressPageShortcut(voyager, 'd', ['alt'])

  const input = voyager.chrome.locator('#omnibox-input')
  await expect(input).toBeFocused()
  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) => {
        const chrome = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith('file:'))
        return chrome?.isFocused() ?? false
      })
    )
    .toBe(true)

  // The shortcut must leave the bar ready for typing, not just visually focused.
  await voyager.chrome.keyboard.type('example.com')
  await expect(input).toHaveValue('example.com')
})

test('Alt+D matches by physical key, including Option+D on macOS', () => {
  const chord = { shift: false, meta: false, ctrl: false, alt: true }
  // Option+D reports key '∂' on macOS; the physical key is still KeyD.
  expect(matchShortcut({ ...chord, key: '∂', code: 'KeyD' }, 'darwin')?.action).toBe(
    'focus-omnibox'
  )
  expect(matchShortcut({ ...chord, key: 'd', code: 'KeyD' }, 'linux')?.action).toBe('focus-omnibox')
  // Cmd/Ctrl+Alt+D must stay unbound, and Cmd/Ctrl+D is still "bookmark page".
  expect(matchShortcut({ ...chord, meta: true, key: 'd', code: 'KeyD' }, 'darwin')).toBeNull()
  expect(matchShortcut({ ...chord, ctrl: true, key: 'd', code: 'KeyD' }, 'linux')).toBeNull()
  expect(
    matchShortcut({ ...chord, alt: false, ctrl: true, key: 'd', code: 'KeyD' }, 'linux')?.action
  ).toBe('bookmark-page')
})

test('Escape abandons edits and restores the active URL', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  const input = voyager.chrome.locator('#omnibox-input')

  await input.focus()
  await input.fill('not the real address')
  await expect(input).toHaveValue('not the real address')

  await input.press('Escape')
  await expect(input).toHaveValue(displayUrl(server.url('/home')))
  const focused = await voyager.chrome.evaluate(
    () => document.activeElement?.id === 'omnibox-input'
  )
  expect(focused).toBe(false)
})

test('renders search suggestions and runs the highlighted one', async ({ voyager, server }) => {
  await interceptSearch(voyager, server)
  const input = voyager.chrome.locator('#omnibox-input')

  await input.focus()
  await input.fill('al')
  await expect(voyager.chrome.getByText('alpha suggestion')).toBeVisible()
  await expect(voyager.chrome.getByText('Search DuckDuckGo')).toBeVisible()

  await input.press('ArrowDown')
  await input.press('Enter')

  await voyager.waitForTab(
    (tab) => tab.url === server.url('/search?q=alpha%20suggestion') && !tab.loading
  )
  await expect(voyager.tab.locator('#query')).toHaveText('alpha suggestion')
  expect(await searchRequests(voyager.app)).toContain(
    'https://duckduckgo.com/?q=alpha%20suggestion'
  )
})

test('submits a typed search query when no suggestion is highlighted', async ({
  voyager,
  server
}) => {
  await interceptSearch(voyager, server)
  const input = voyager.chrome.locator('#omnibox-input')

  await input.fill('c++ & rust')
  await input.press('Enter')

  await voyager.waitForTab(
    (tab) => tab.url === server.url('/search?q=c%2B%2B%20%26%20rust') && !tab.loading
  )
  await expect(voyager.tab.locator('#query')).toHaveText('c++ & rust')
  expect(await searchRequests(voyager.app)).toContain(
    'https://duckduckgo.com/?q=c%2B%2B%20%26%20rust'
  )
})

test('describes an insecure HTTP page in the site information popover', async ({
  voyager,
  server
}) => {
  const insecureUrl = server.url('/home').replace('127.0.0.1', 'insecure.test')
  await voyager.navigate(insecureUrl)
  const badge = voyager.chrome.getByRole('button', { name: 'View site information' })
  await expect(badge).toBeVisible()

  await badge.click()
  await expect(voyager.chrome.getByText('Connection is not secure')).toBeVisible()
  await expect(voyager.chrome.getByText('Use HTTPS to protect your data')).toBeVisible()
  await expect(voyager.chrome.getByText('Local browser tab')).toHaveCount(0)

  await badge.click()
  await expect(voyager.chrome.getByText('Connection is not secure')).toHaveCount(0)
})

test('does not show a site information button for a blank tab', async ({ voyager }) => {
  await expect(voyager.chrome.getByRole('button', { name: 'View site information' })).toHaveCount(0)
  await expect(voyager.chrome.locator('#omnibox-input')).toHaveValue('')
})
