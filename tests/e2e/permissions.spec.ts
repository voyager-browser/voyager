import { expect, test } from './fixtures'
import { openSettings } from './helpers/voyager'

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
