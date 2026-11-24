/**
 * Download a Chrome theme CRX from the Web Store update service. Kept separate
 * from the archive parser so URL handling can be tested without Electron.
 */

import { chromeWebStoreExtensionId } from '../../shared/theme'

const DEFAULT_ENDPOINT = 'https://clients2.google.com/service/update2/crx'
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024

/** Fetch the CRX for a Chrome Web Store item URL or raw extension id. */
export async function downloadChromeWebStoreCrx(
  input: string,
  endpoint = DEFAULT_ENDPOINT
): Promise<Uint8Array> {
  const id = chromeWebStoreExtensionId(input)
  if (!id) throw new Error('Enter a Chrome Web Store theme URL or 32-character id.')

  const url = new URL(endpoint)
  url.searchParams.set('response', 'redirect')
  url.searchParams.set('prod', 'chromecrx')
  url.searchParams.set('prodversion', process.versions.chrome || '141.0.0.0')
  url.searchParams.set('acceptformat', 'crx2,crx3')
  url.searchParams.set('x', `id=${id}&installsource=ondemand&uc`)

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000)
  })
  if (!response.ok) throw new Error(`Chrome Web Store returned ${response.status}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Chrome Web Store returned an invalid theme archive.')
  }
  const magic = String.fromCharCode(...bytes.subarray(0, 4))
  if (magic !== 'Cr24' && !magic.startsWith('PK')) {
    throw new Error('Chrome Web Store did not return a Chrome extension package.')
  }
  return bytes
}
