import { tlsConnectionTarget } from '../../src/main/certificates/tlsTarget'
import { hasTlsCertificate } from '../../src/shared/url'
import { expect, test } from './fixtures'

test('certificate lookups strip IPv6 brackets and omit SNI for IP literals', () => {
  // URL.hostname keeps the brackets that make IPv6 literals valid URL hosts.
  expect(tlsConnectionTarget(new URL('https://[::1]:8443/').hostname)).toEqual({
    host: '::1',
    servername: undefined
  })
  expect(tlsConnectionTarget('[2001:db8::1]')).toEqual({
    host: '2001:db8::1',
    servername: undefined
  })
  expect(tlsConnectionTarget('[fe80::1%25en0]')).toEqual({
    host: 'fe80::1%25en0',
    servername: undefined
  })
  // Unbracketed literals and IPv4 addresses are never SNI names either.
  expect(tlsConnectionTarget('::1')).toEqual({ host: '::1', servername: undefined })
  expect(tlsConnectionTarget('127.0.0.1')).toEqual({ host: '127.0.0.1', servername: undefined })
  expect(tlsConnectionTarget('example.com')).toEqual({
    host: 'example.com',
    servername: 'example.com'
  })
})

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
