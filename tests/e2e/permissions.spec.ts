import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SitePermissionDecision } from '../../src/shared/types'
import { expect, test } from './fixtures'
import { openSettings, pollUntil, type VoyagerApp } from './helpers/voyager'

interface PermissionsStoreFile {
  decisions: SitePermissionDecision[]
  autoRemovedDecisions?: SitePermissionDecision[]
}

function readPermissions(userDataDir: string): PermissionsStoreFile {
  return JSON.parse(
    readFileSync(join(userDataDir, 'permissions.json'), 'utf8')
  ) as PermissionsStoreFile
}

function writePermissions(userDataDir: string, state: PermissionsStoreFile): void {
  writeFileSync(join(userDataDir, 'permissions.json'), JSON.stringify(state, null, 2))
}

async function chromePages(app: ElectronApplication): Promise<Page[]> {
  return app
    .windows()
    .filter((page) => !page.isClosed() && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url()))
}

async function incognitoChromePage(voyager: VoyagerApp): Promise<Page> {
  return pollUntil(async () => {
    for (const page of await chromePages(voyager.app)) {
      if (page === voyager.chrome) continue
      try {
        const state = await page.evaluate(() => window.voyager?.windows?.getState())
        if (state?.incognito) return page
      } catch {
        // The renderer bridge may not be exposed yet.
      }
    }
    return undefined
  })
}

test('shows a location prompt with the site, action and all three choices', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/permissions'))
  await voyager.tab.getByRole('button', { name: 'Ask for location' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText(new URL(server.origin).host)
  await expect(prompt).toContainText('wants to')
  await expect(prompt).toContainText('Know your location')
  await expect(prompt.getByRole('button', { name: 'Allow while visiting the site' })).toBeVisible()
  await expect(prompt.getByRole('button', { name: 'Allow this time' })).toBeVisible()
  await expect(prompt.getByRole('button', { name: 'Never allow' })).toBeVisible()
  await expect(prompt.getByRole('button', { name: 'Not this time' })).toBeVisible()

  await prompt.getByRole('button', { name: 'Not this time' }).click()
  await expect(prompt).not.toBeVisible()

  const state = await voyager.chrome.evaluate(() => window.voyager.permissions.getState())
  expect(state.decisions).toEqual([])
})

test('dismissing a request does not persist and it can be asked again on refresh', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/permissions'))
  await voyager.tab.getByRole('button', { name: 'Ask for notifications' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Not this time' }).click()
  await expect(prompt).not.toBeVisible()

  await voyager.tab.reload()
  await voyager.tab.getByRole('button', { name: 'Ask for notifications' }).click()
  await expect(prompt).toBeVisible()

  await prompt.getByRole('button', { name: 'Never allow' }).click()
  await expect(prompt).not.toBeVisible()
})

test('allows a site persistently and manages the decision in Settings', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/permissions'))
  await voyager.tab.getByRole('button', { name: 'Ask for notifications' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Allow while visiting the site' }).click()
  await expect(prompt).not.toBeVisible()

  const host = new URL(server.origin).host
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.permissions.getState())).decisions
          .length
    )
    .toBe(1)

  const settings = await openSettings(voyager)
  await settings.getByRole('button', { name: /Site permissions/ }).click()
  await expect(settings.getByRole('heading', { name: 'Site permissions' })).toBeVisible()
  await expect(settings.getByText(host, { exact: true })).toBeVisible()
  await expect(settings.getByText('Allowed')).toBeVisible()

  await settings.getByRole('button', { name: /Remove .* permission for/ }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.permissions.getState())).decisions
          .length
    )
    .toBe(0)
  await expect(settings.getByText('No saved site permissions yet.')).toBeVisible()
})

test('allows a request for this tab without persisting it', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/permissions'))
  await voyager.tab.getByRole('button', { name: 'Ask for notifications' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Allow this time' }).click()
  await expect(prompt).not.toBeVisible()
  await expect(voyager.tab.locator('#permission-result')).toHaveText('Notifications:granted')

  const state = await voyager.chrome.evaluate(() => window.voyager.permissions.getState())
  expect(state.decisions).toEqual([])
})

test('incognito site-wide permission choices do not leak into the normal profile', async ({
  voyager,
  server
}) => {
  await voyager.chrome.evaluate(() => window.voyager.windows.openIncognito())
  const incognitoChrome = await incognitoChromePage(voyager)
  await expect
    .poll(async () => voyager.tabPages().length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2)
  const incognitoTab = voyager.tabPages().find((page) => page !== voyager.tab)
  if (!incognitoTab) throw new Error('Incognito tab not found')

  await incognitoChrome.evaluate(
    (url) => window.voyager.navigation.go(url),
    server.url('/permissions')
  )
  await expect
    .poll(
      async () => {
        const state = await incognitoChrome.evaluate(() => window.voyager.tabs.getState())
        return state.tabs[0]?.url
      },
      { timeout: 20_000 }
    )
    .toContain('/permissions')
  await incognitoTab.getByRole('button', { name: 'Ask for notifications' }).click()

  const prompt = incognitoChrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Allow while visiting the site' }).click()
  await expect(prompt).not.toBeVisible()

  // The normal profile must not gain the incognito decision.
  const normalState = await voyager.chrome.evaluate(() => window.voyager.permissions.getState())
  expect(normalState.decisions).toEqual([])

  // The choice still applies inside the incognito session without a new prompt.
  await incognitoTab.reload()
  await incognitoTab.getByRole('button', { name: 'Ask for notifications' }).click()
  await expect(incognitoTab.locator('#permission-result')).toHaveText('Notifications:granted')
  await expect(incognitoChrome.getByRole('dialog')).toHaveCount(0)
})

test('undo restores every batch of auto-removed permissions', async ({ launchVoyager }) => {
  const staleDecision = (
    origin: string,
    updatedAt: number,
    decision: SitePermissionDecision['decision'] = 'allow'
  ): SitePermissionDecision => ({ origin, kind: 'camera', decision, updatedAt })
  const siteA = staleDecision('https://a.example', 1)
  const siteB = staleDecision('https://b.example', 2)
  const siteC = staleDecision('https://c.example', 3)

  const first = await launchVoyager({
    seed: {
      history: { entries: [] },
      permissions: { decisions: [siteA, siteB], autoRemovedDecisions: [] }
    }
  })
  await expect
    .poll(
      async () =>
        (await first.chrome.evaluate(() => window.voyager.permissions.getState()))
          .autoRemovedDecisions
    )
    .toHaveLength(2)
  await first.close()

  const afterFirstPass = readPermissions(first.userDataDir)
  expect(afterFirstPass.decisions).toEqual([])
  expect(afterFirstPass.autoRemovedDecisions?.map((item) => item.origin)).toEqual([
    siteA.origin,
    siteB.origin
  ])

  // A later stale grant is removed on the next launch without dropping A or B.
  writePermissions(first.userDataDir, {
    decisions: [siteC],
    autoRemovedDecisions: afterFirstPass.autoRemovedDecisions
  })
  const second = await launchVoyager({ userDataDir: first.userDataDir })
  await expect
    .poll(
      async () =>
        (await second.chrome.evaluate(() => window.voyager.permissions.getState()))
          .autoRemovedDecisions
    )
    .toHaveLength(3)
  await second.close()

  const afterSecondPass = readPermissions(first.userDataDir)
  expect(afterSecondPass.autoRemovedDecisions?.map((item) => item.origin)).toEqual([
    siteA.origin,
    siteB.origin,
    siteC.origin
  ])

  // Removing C again de-duplicates by origin/category and keeps the newest
  // decision rather than restoring an older copy on Undo.
  const newerC = staleDecision(siteC.origin, siteC.updatedAt + 1_000, 'block')
  writePermissions(first.userDataDir, {
    decisions: [newerC],
    autoRemovedDecisions: afterSecondPass.autoRemovedDecisions
  })
  const third = await launchVoyager({ userDataDir: first.userDataDir })
  const beforeUndo = await third.chrome.evaluate(() => window.voyager.permissions.getState())
  expect(beforeUndo.decisions).toEqual([])
  expect(beforeUndo.autoRemovedDecisions).toHaveLength(3)
  expect(
    beforeUndo.autoRemovedDecisions?.find((item) => item.origin === siteC.origin)?.decision
  ).toBe('block')

  const afterUndo = await third.chrome.evaluate(() => window.voyager.permissions.undoAutoRemoval())
  expect(afterUndo.decisions.map((item) => item.origin)).toEqual([
    siteA.origin,
    siteB.origin,
    siteC.origin
  ])
  expect(afterUndo.decisions.find((item) => item.origin === siteC.origin)?.decision).toBe('block')
  expect(afterUndo.autoRemovedDecisions).toEqual([])
  await third.close()
})
