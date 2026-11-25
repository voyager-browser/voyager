import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures'
import { pollUntil, windowCount } from './helpers/voyager'

async function chromePages(app: ElectronApplication) {
  return app
    .windows()
    .filter((page) => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()))
}

async function chromePageForProfile(
  app: ElectronApplication,
  profileId: string,
  incognito: boolean
) {
  return pollUntil(async () => {
    for (const page of await chromePages(app)) {
      try {
        const state = await page.evaluate(() => window.voyager?.windows?.getState())
        if (state?.profile.id === profileId && state.incognito === incognito) return page
      } catch {
        // The renderer may not have exposed the bridge yet.
      }
    }
    return undefined
  })
}

/**
 * Playwright's Page handle for an Electron WebContentsView can report a tab's
 * URL while evaluating in the chrome view of the same window. Query the live
 * tab WebContents from the main process instead so the UA comes from the page
 * under test.
 */
async function tabUserAgent(app: ElectronApplication, url: string): Promise<string | undefined> {
  return app.evaluate(async ({ webContents }, targetUrl) => {
    const candidates = webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed() && contents.getURL() === targetUrl)
    for (const contents of candidates) {
      try {
        const ua = await Promise.race([
          contents.executeJavaScript('navigator.userAgent'),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_000))
        ])
        if (typeof ua === 'string' && ua.length > 0) return ua
      } catch {
        // The view may have been replaced; try the next matching one.
      }
    }
    return undefined
  }, url)
}

test('opens an incognito window with a visible badge', async ({ voyager }) => {
  const before = await windowCount(voyager.app)
  await voyager.chrome.evaluate(() => window.voyager.windows.openIncognito())
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)

  await expect
    .poll(async () => (await chromePages(voyager.app)).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2)

  const pages = await chromePages(voyager.app)
  const incognitoChrome = pages.find((page) => page !== voyager.chrome) ?? pages[1]
  const badge = incognitoChrome.getByText('Incognito', { exact: true })
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', 'You are in incognito mode')

  const state = await incognitoChrome.evaluate(() => window.voyager.windows.getState())
  expect(state.incognito).toBe(true)
})

test('incognito tabs use the user agent of the profile that opened them', async ({
  voyager,
  server
}) => {
  const defaultUA = 'Mozilla/5.0 (X11; Linux x86_64) VoyagerDefault/1.0'
  const workUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoyagerWork/1.0'
  await voyager.chrome.evaluate((ua) => window.voyager.settings.set('userAgent', ua), defaultUA)

  const profile = await voyager.chrome.evaluate(() =>
    window.voyager.profiles.create({ name: 'Work' })
  )
  await voyager.chrome.evaluate((id) => window.voyager.profiles.openWindow(id), profile.id)
  const workChrome = await chromePageForProfile(voyager.app, profile.id, false)
  await workChrome.evaluate((ua) => window.voyager.settings.set('userAgent', ua), workUA)

  // The named profile's normal tabs are the control: they must show its UA.
  // Create the tab after setting the preference because the tab preload reads
  // the profile UA once, when its WebContents is created.
  await workChrome.evaluate((url) => window.voyager.tabs.create({ url }), server.url('/home'))
  await expect.poll(() => tabUserAgent(voyager.app, server.url('/home'))).toBe(workUA)

  await workChrome.evaluate(
    (url) => window.voyager.windows.openIncognito(url),
    server.url('/second')
  )
  const incognitoChrome = await chromePageForProfile(voyager.app, profile.id, true)
  const incognitoState = await incognitoChrome.evaluate(() => window.voyager.windows.getState())
  expect(incognitoState.incognito).toBe(true)
  expect(incognitoState.profile.id).toBe(profile.id)

  await expect.poll(() => tabUserAgent(voyager.app, server.url('/second'))).toBe(workUA)
})

test('opens an incognito window from the File menu', async ({ voyager }) => {
  test.skip(process.platform !== 'darwin', 'Uses application menu click path')
  const before = await windowCount(voyager.app)
  await voyager.app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File')
    file?.submenu?.items.find((item) => item.label === 'New Incognito Window')?.click()
  })
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before + 1)
})

test('incognito autofill data stays isolated from the owning profile', async ({
  voyager,
  server
}) => {
  await voyager.chrome.evaluate(() =>
    window.voyager.autofill.saveContact({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-0100'
    })
  )
  const owner = await voyager.chrome.evaluate(() => window.voyager.windows.getState())
  await voyager.chrome.evaluate(
    (url) => window.voyager.windows.openIncognito(url),
    server.url('/second')
  )
  const incognitoChrome = await chromePageForProfile(voyager.app, owner.profile.id, true)

  // The incognito renderer must not see the owner's saved contacts even though
  // it resolves to the same profile for settings and user agent purposes.
  const incognitoState = await incognitoChrome.evaluate(() => window.voyager.autofill.getState())
  expect(incognitoState.contacts.map((contact) => contact.email)).not.toContain('alice@example.com')

  const targetUrl = server.url('/second')
  await expect
    .poll(async () =>
      voyager.app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .some((candidate) => !candidate.isDestroyed() && candidate.getURL() === url),
        targetUrl
      )
    )
    .toBe(true)

  // Blurring a text control invokes AutofillRecordFormField from the tab.
  await voyager.app.evaluate(async ({ webContents }, url) => {
    const tab = webContents
      .getAllWebContents()
      .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
    if (!tab) throw new Error('Incognito tab WebContents not found')
    await tab.executeJavaScript(`
        (() => {
          const input = document.createElement('input')
          input.setAttribute('autocomplete', 'email')
          document.body.appendChild(input)
          input.focus()
          input.value = 'incognito-only@example.com'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.blur()
        })()
      `)
  }, targetUrl)

  await expect
    .poll(async () => {
      const state = await incognitoChrome.evaluate(() => window.voyager.autofill.getState())
      return state.formHistory.map((entry) => entry.value)
    })
    .toContain('incognito-only@example.com')

  const normalState = await voyager.chrome.evaluate(() => window.voyager.autofill.getState())
  expect(normalState.formHistory.map((entry) => entry.value)).not.toContain(
    'incognito-only@example.com'
  )
  expect(normalState.contacts.map((contact) => contact.email)).toContain('alice@example.com')
})

test('incognito sessions inherit the owner proxy, spellcheck and content blocking', async ({
  voyager,
  server
}) => {
  await voyager.chrome.evaluate(() => window.voyager.settings.set('spellcheck', false))
  await voyager.chrome.evaluate(() => window.voyager.settings.set('contentBlocking', true))
  await voyager.chrome.evaluate(() => window.voyager.settings.set('proxyMode', 'fixed_servers'))
  await voyager.chrome.evaluate(() => window.voyager.settings.set('proxyHost', '127.0.0.1'))
  await voyager.chrome.evaluate(() => window.voyager.settings.set('proxyPort', 18888))
  // Keep the local test server reachable while external URLs use the proxy.
  await voyager.chrome.evaluate(() => window.voyager.settings.set('proxyBypassRules', '127.0.0.1'))

  const owner = await voyager.chrome.evaluate(() => window.voyager.windows.getState())
  const before = await windowCount(voyager.app)
  const targetUrl = server.url('/second')
  await voyager.chrome.evaluate((url) => window.voyager.windows.openIncognito(url), targetUrl)
  const incognitoChrome = await chromePageForProfile(voyager.app, owner.profile.id, true)

  await expect
    .poll(async () =>
      voyager.app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .some((candidate) => !candidate.isDestroyed() && candidate.getURL() === url),
        targetUrl
      )
    )
    .toBe(true)

  const policies = await voyager.app.evaluate(async ({ webContents }, url) => {
    const tab = webContents
      .getAllWebContents()
      .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
    if (!tab) throw new Error('Incognito tab WebContents not found')
    return {
      storagePath: tab.session.storagePath,
      proxy: await tab.session.resolveProxy('http://example.com'),
      spellcheck: tab.session.isSpellCheckerEnabled()
    }
  }, targetUrl)
  expect(policies.storagePath).toBeFalsy()
  expect(policies.proxy).toContain('127.0.0.1:18888')
  expect(policies.spellcheck).toBe(false)

  // A tracker in the incognito tab is cancelled by the inherited blocker.
  await voyager.app.evaluate(
    async ({ webContents }, input) => {
      const tab = webContents
        .getAllWebContents()
        .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === input.url)
      if (!tab) throw new Error('Incognito tab WebContents not found')
      await tab.executeJavaScript(`
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve(true)
          image.onerror = () => resolve(true)
          image.src = ${JSON.stringify(input.pixel)}
          setTimeout(() => resolve(false), 3000)
        })
      `)
    },
    { url: targetUrl, pixel: 'https://www.google-analytics.com/collect' }
  )

  await expect
    .poll(
      async () =>
        (await incognitoChrome.evaluate(() => window.voyager.contentBlocking.getStats()))
          .pageBlocked
    )
    .toBeGreaterThan(0)

  const privateStats = await incognitoChrome.evaluate(() =>
    window.voyager.contentBlocking.getStats()
  )
  expect(privateStats.sessionBlocked).toBeGreaterThan(0)
  expect(privateStats.topHosts.map((host) => host.host)).toContain('www.google-analytics.com')

  // The owner's privacy dashboard must not inherit private counters.
  const normalStats = await voyager.chrome.evaluate(() => window.voyager.contentBlocking.getStats())
  expect(normalStats.sessionBlocked).toBe(0)
  expect(normalStats.topHosts).toEqual([])

  await incognitoChrome.evaluate(() => window.voyager.windows.close()).catch(() => undefined)
  await expect.poll(async () => windowCount(voyager.app), { timeout: 10_000 }).toBe(before)

  const statsAfterClose = await voyager.chrome.evaluate(() =>
    window.voyager.contentBlocking.getStats()
  )
  expect(statsAfterClose.sessionBlocked).toBe(0)
  expect(statsAfterClose.topHosts).toEqual([])
})
