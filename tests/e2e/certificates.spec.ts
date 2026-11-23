import { hasTlsCertificate } from '../../src/shared/url'
import { expect, test } from './fixtures'

test('certificate details are only available for HTTPS URLs', () => {
  expect(hasTlsCertificate('https://example.com/')).toBe(true)
  expect(hasTlsCertificate('https://localhost:8443/')).toBe(true)

  // Local HTTP pages and internal/browser pages have no TLS certificate to
  // inspect, even though the omnibox badge treats localhost/file as secure.
  expect(hasTlsCertificate('http://localhost:5173/start.html')).toBe(false)
  expect(hasTlsCertificate('http://127.0.0.1:8080/')).toBe(false)
  expect(hasTlsCertificate('file:///tmp/page.html')).toBe(false)
  expect(hasTlsCertificate('voyager://start')).toBe(false)
  expect(hasTlsCertificate('not a url')).toBe(false)
})

test('site information hides certificate details on a local HTTP page', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  const badge = voyager.chrome.getByRole('button', { name: 'View site information' })
  await expect(badge).toBeVisible()
  await badge.click()

  await expect(voyager.chrome.getByText('Connection is secure')).toBeVisible()
  await expect(voyager.chrome.getByRole('button', { name: 'View certificate' })).toHaveCount(0)
})
