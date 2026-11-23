import { attachWindowScreenshots, expect, test } from './fixtures'

test('attaches Electron window screenshots for Playwright UI mode', async ({
  voyager
}, testInfo) => {
  await expect(voyager.chrome).toHaveTitle('Voyager')

  await attachWindowScreenshots(voyager, testInfo)

  const screenshots = testInfo.attachments.filter(
    (attachment) => attachment.contentType === 'image/png'
  )
  expect(screenshots.length).toBeGreaterThan(0)
  expect(screenshots[0].name).toBe('screenshot')
})
