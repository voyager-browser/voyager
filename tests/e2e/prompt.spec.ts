import { expect, test } from './fixtures'
import type { VoyagerApp } from './helpers/voyager'

/**
 * Trigger `window.prompt` from a timer so the evaluate call can return before
 * the page renderer blocks inside the synchronous prompt IPC.
 */
async function promptOnPage(
  voyager: VoyagerApp,
  message: string,
  defaultValue?: string
): Promise<void> {
  await voyager.tab.evaluate(
    ({ message: text, defaultValue: initial }) => {
      setTimeout(() => {
        const answer = window.prompt(text, initial)
        const result = document.getElementById('prompt-result')
        if (result) result.textContent = answer === null ? 'cancelled' : `answer:${answer}`
      }, 0)
    },
    { message, defaultValue }
  )
}

test('window.prompt renders the message and returns the entered value', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/prompt'))
  await promptOnPage(voyager, 'What is your name?', 'Ada Lovelace')

  const dialog = voyager.chrome.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(voyager.chrome.locator('#prompt-title')).toHaveText('127.0.0.1 would like to ask:')
  await expect(voyager.chrome.locator('#prompt-message')).toHaveText('What is your name?')

  const input = voyager.chrome.locator('#prompt-input')
  await expect(input).toHaveValue('Ada Lovelace')
  await input.fill('Grace Hopper')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()

  await expect(voyager.tab.locator('#prompt-result')).toHaveText('answer:Grace Hopper')
  await expect(dialog).toHaveCount(0)
})

test('cancelling a prompt returns null and a blank message still shows an input', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/prompt'))
  await promptOnPage(voyager, '')

  const dialog = voyager.chrome.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(voyager.chrome.locator('#prompt-title')).toHaveText('127.0.0.1 would like to ask:')
  await expect(voyager.chrome.locator('#prompt-message')).toHaveCount(0)
  await expect(voyager.chrome.locator('#prompt-input')).toHaveValue('')

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await expect(voyager.tab.locator('#prompt-result')).toHaveText('cancelled')
  await expect(dialog).toHaveCount(0)
})
