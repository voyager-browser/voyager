import { isNewTab } from '../../src/shared/url'
import { expect, test } from './fixtures'

test('restores persisted tabs and active index', async ({ launchVoyager, server }) => {
  const voyager = await launchVoyager({
    seed: {
      settings: { restoreSession: true },
      session: {
        tabs: [
          { url: server.url('/home'), title: 'Voyager Test Home', pinned: false },
          { url: server.url('/second'), title: 'Second Page', pinned: true }
        ],
        activeIndex: 1
      }
    }
  })

  await expect
    .poll(async () => (await voyager.state()).tabs.map((tab: any) => tab.url))
    .toEqual(expect.arrayContaining([server.url('/home'), server.url('/second')]))
  expect((await voyager.state()).tabs.length).toBe(2)
  expect((await voyager.state()).tabs.filter((tab: any) => tab.pinned).length).toBe(1)

  const active = await voyager.activeTab()
  expect(active.url).toBe(server.url('/second'))
  const activePage = await voyager.tabPage('/second')
  await expect(activePage.locator('#heading')).toHaveText('Second Page')

  await voyager.close()
})

test('ignores a saved session when restore is disabled (the default)', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({
    seed: {
      // restoreSession is absent, i.e. the default (off).
      session: {
        tabs: [{ url: server.url('/home'), title: 'Voyager Test Home', pinned: false }],
        activeIndex: 0
      }
    }
  })

  const state = await voyager.state()
  expect(state.tabs.length).toBe(1)
  expect(isNewTab(state.tabs[0].url)).toBe(true)

  await voyager.close()
})

test('falls back to a blank tab when no session is saved', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { session: { tabs: [], activeIndex: 0 } }
  })

  const state = await voyager.state()
  expect(state.tabs.length).toBe(1)
  expect(isNewTab(state.tabs[0].url)).toBe(true)
  expect(isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.close()
})
