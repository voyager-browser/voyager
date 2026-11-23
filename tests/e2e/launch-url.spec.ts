import { expect, test } from './fixtures'
import { openSettings, windowCount } from './helpers/voyager'

test('opens a URL passed as a launch argument', async ({ launchVoyager, server }) => {
  const voyager = await launchVoyager({ args: [server.url('/home')] })

  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))
  expect((await voyager.state()).tabs).toHaveLength(1)

  await voyager.close()
})

test('opens the launch URL alongside restored tabs', async ({ launchVoyager, server }) => {
  const voyager = await launchVoyager({
    args: [server.url('/second')],
    seed: {
      settings: { restoreSession: true },
      session: {
        tabs: [{ url: server.url('/home'), title: 'Voyager Test Home', pinned: false }],
        activeIndex: 0
      }
    }
  })

  await expect.poll(async () => (await voyager.state()).tabs).toHaveLength(2)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/second'))

  await voyager.close()
})

test('opens URLs queued while no browser window is open', async ({ voyager, server }) => {
  // Keep the app alive with only the Settings window, then close the browser.
  await openSettings(voyager)
  await voyager.chrome.evaluate(() => window.voyager.windows.close())
  // Wait until only the Settings window remains, so the registry no longer
  // reports an active browser window and the links below are queued.
  await expect.poll(async () => windowCount(voyager.app)).toBe(1)

  const first = server.url('/home')
  const second = server.url('/second')
  await voyager.app.evaluate(
    ({ app }, urls) => {
      for (const url of urls) {
        app.emit('open-url', { preventDefault() {} } as never, url)
      }
    },
    [first, second]
  )

  // Creating the next window must drain the queue instead of dropping it.
  await voyager.app.evaluate(({ app }) => app.emit('activate'))
  await expect
    .poll(async () => voyager.tabPages().map((page) => page.url()))
    .toEqual(expect.arrayContaining([first, second]))
})
