import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { parseCrxTheme, parseThemeFiles } from '../../src/main/theme/chromeTheme'
import { downloadChromeWebStoreCrx } from '../../src/main/theme/chromeStore'
import {
  chromeWebStoreExtensionId,
  contrastRatio,
  defaultColors,
  deriveChromeThemeColors,
  normalizeHexColor
} from '../../src/shared/theme'
import { startPageUrl } from '../../src/shared/url'
import { expect, test } from './fixtures'

interface ZipEntry {
  name: string
  content: Buffer
}

/** Minimal stored-entry ZIP writer for CRX parsing tests. */
function makeZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(entry.content.length, 18)
    header.writeUInt32LE(entry.content.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.content)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(entry.content.length, 20)
    directory.writeUInt32LE(entry.content.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)

    offset += header.length + name.length + entry.content.length
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

function makeCrx2(zip: Buffer): Buffer {
  const header = Buffer.alloc(16)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  return Buffer.concat([header, zip])
}

function makeCrx3(zip: Buffer): Buffer {
  const header = Buffer.alloc(12)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(3, 4)
  header.writeUInt32LE(5, 8)
  const protobufHeader = Buffer.from([0x12, 0x03, 0x41, 0x42, 0x43])
  return Buffer.concat([header, protobufHeader, zip])
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const MANIFEST = JSON.stringify({
  manifest_version: 2,
  name: 'Midnight Voyager',
  version: '1.2.3',
  theme: {
    colors: {
      frame: [30, 40, 60],
      toolbar: [25, 30, 45],
      tab_background_text: [245, 245, 245]
    },
    images: { theme_frame: 'images/frame.png' }
  }
})

const STORE_ID = 'lahipjfggmgneaopcckkaipmoandaboo'
const STORE_URL = `https://chromewebstore.google.com/detail/sea-foam/${STORE_ID}`
const STORE_MANIFEST = JSON.stringify({
  manifest_version: 2,
  name: 'Sea Foam',
  version: '1.1',
  theme: {
    colors: {
      frame: [178, 224, 223],
      toolbar: [241, 255, 254],
      ntp_background: [178, 224, 223],
      tab_text: [9, 50, 47],
      tab_background_text: [9, 50, 47],
      ntp_text: [241, 255, 254]
    },
    tints: { buttons: [0.5, 1, 0.1] }
  }
})

test('Chrome theme colors map to readable chrome tokens', () => {
  const colors = deriveChromeThemeColors(
    {
      frame: [30, 40, 60],
      toolbar: [25, 30, 45],
      tab_background_text: [245, 245, 245]
    },
    false
  )

  expect(colors.background).toBe('#1e283c')
  expect(colors.surface).toBe('#191e2d')
  expect(contrastRatio(colors.foreground, colors.surface)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(colors.accent, colors.surface)).toBeGreaterThanOrEqual(3)
  expect(contrastRatio(colors.muted, colors.surface)).toBeGreaterThanOrEqual(3)
})

test('normalizes Chrome color arrays without scaling small integers', () => {
  expect(normalizeHexColor([30, 40, 60])).toBe('#1e283c')
  expect(normalizeHexColor([1, 1, 1])).toBe('#010101')
  expect(normalizeHexColor([0.5, 0.5, 0.5])).toBe('#808080')
  expect(normalizeHexColor('rgb(255, 0, 128)')).toBe('#ff0080')
})

test('parses CRX2 and CRX3 theme packs with their background image', () => {
  const zip = makeZip([
    { name: 'manifest.json', content: Buffer.from(MANIFEST) },
    { name: 'images/frame.png', content: PNG }
  ])

  for (const crx of [makeCrx2(zip), makeCrx3(zip)]) {
    const theme = parseCrxTheme(crx, false)
    expect(theme.name).toBe('Midnight Voyager')
    expect(theme.version).toBe('1.2.3')
    expect(theme.source).toBe('chrome-crx')
    expect(theme.colors.background).toBe('#1e283c')
    expect(theme.image?.name).toBe('images/frame.png')
    expect(theme.image?.data).toEqual(PNG)
  }
})

test('parses loose manifest and image files', () => {
  const theme = parseThemeFiles(
    [
      {
        name: 'manifest.json',
        mimeType: 'application/json',
        data: Buffer.from(MANIFEST).toString('base64')
      },
      { name: 'other.png', mimeType: 'image/png', data: PNG.toString('base64') }
    ],
    false
  )

  expect(theme.source).toBe('chrome-manifest')
  expect(theme.colors.surface).toBe('#191e2d')
  expect(theme.image?.name).toBe('other.png')
})

test('rejects archives without a Chrome theme manifest', () => {
  const zip = makeZip([{ name: 'README.txt', content: Buffer.from('not a theme') }])
  expect(() => parseCrxTheme(makeCrx2(zip), false)).toThrow(/manifest\.json/)
})

test('extracts Chrome Web Store theme ids from URLs and raw ids', () => {
  expect(chromeWebStoreExtensionId(STORE_URL)).toBe(STORE_ID)
  expect(chromeWebStoreExtensionId(`${STORE_URL}?hl=en`)).toBe(STORE_ID)
  expect(chromeWebStoreExtensionId(STORE_ID.toUpperCase())).toBe(STORE_ID)
  expect(chromeWebStoreExtensionId('https://example.com/theme')).toBeNull()
})

test('parses a color-only Web Store theme such as Sea Foam', () => {
  const zip = makeZip([{ name: 'manifest.json', content: Buffer.from(STORE_MANIFEST) }])
  const theme = parseCrxTheme(makeCrx3(zip), false)

  expect(theme.name).toBe('Sea Foam')
  expect(theme.image).toBeUndefined()
  expect(theme.colors.background).toBe('#b2e0df')
  expect(theme.colors.surface).toBe('#f1fffe')
  expect(theme.colors.foreground).toBe('#09322f')
})

test('adopts an already installed Chrome theme at startup', async ({
  userDataDir,
  launchVoyager
}) => {
  const extensionPath = join(userDataDir, 'installed-themes', 'sea-foam')
  mkdirSync(extensionPath, { recursive: true })
  writeFileSync(join(extensionPath, 'manifest.json'), STORE_MANIFEST)

  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [extensionPath] } }
  })

  await expect
    .poll(() => voyager.chrome.evaluate(() => window.voyager.theme.get()))
    .toEqual(
      expect.objectContaining({
        chrome: expect.objectContaining({ name: 'Sea Foam', source: 'chrome-extension' })
      })
    )
  await expect
    .poll(() =>
      voyager.chrome.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--voyager-bg').trim()
      )
    )
    .toBe('#b2e0df')

  const badgeColors = await voyager.chrome
    .locator('[aria-label="Developer build"]')
    .evaluate((element) => {
      const style = getComputedStyle(element)
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create a color sampling canvas')

      // Tailwind v4 emits oklch(), which contrastRatio() cannot parse. Draw the
      // colors to a canvas so the assertion measures the rendered sRGB pixels.
      const toHex = (color: string): string => {
        if (!CSS.supports('color', color)) throw new Error(`Unsupported CSS color: ${color}`)
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        return `#${[red, green, blue]
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`
      }
      return { foreground: toHex(style.color), background: toHex(style.backgroundColor) }
    })
  expect(contrastRatio(badgeColors.foreground, badgeColors.background)).toBeGreaterThanOrEqual(4.5)
})

test('downloads a CRX from the Web Store update service', async () => {
  const crx = makeCrx3(makeZip([{ name: 'manifest.json', content: Buffer.from(STORE_MANIFEST) }]))
  let requestUrl = ''
  const server = createServer((request, response) => {
    requestUrl = request.url ?? ''
    response.writeHead(200, {
      'content-type': 'application/x-chrome-extension',
      connection: 'close'
    })
    response.end(crx)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')
    const bytes = await downloadChromeWebStoreCrx(STORE_URL, `http://127.0.0.1:${address.port}/crx`)
    const theme = parseCrxTheme(bytes, false)
    expect(theme.name).toBe('Sea Foam')
    expect(decodeURIComponent(requestUrl)).toContain(`id=${STORE_ID}`)
    expect(requestUrl).toContain('acceptformat=crx2%2Ccrx3')
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('imported Chrome theme recolors the chrome and start page', async ({ voyager }) => {
  const manifest = Buffer.from(STORE_MANIFEST).toString('base64')
  const state = await voyager.chrome.evaluate(
    async (data) =>
      window.voyager.theme.importFiles([
        { name: 'manifest.json', mimeType: 'application/json', data }
      ]),
    manifest
  )

  expect(state.chrome.source).toBe('chrome-manifest')
  await expect
    .poll(() =>
      voyager.chrome.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--voyager-bg').trim()
      )
    )
    .toBe('#b2e0df')
  expect(await voyager.chrome.evaluate(() => document.documentElement.dataset.voyagerTheme)).toBe(
    'chrome-manifest'
  )

  await expect
    .poll(() =>
      voyager.tab.evaluate(() => {
        const root = document.querySelector('[data-start-background]')
        return root ? getComputedStyle(root).backgroundColor : ''
      })
    )
    .toBe('rgb(178, 224, 223)')
})

test('Chrome Web Store install button downloads and applies the theme', async ({
  launchVoyager
}) => {
  const crx = makeCrx3(makeZip([{ name: 'manifest.json', content: Buffer.from(STORE_MANIFEST) }]))
  let crxRequests = 0
  const server = createServer((_request, response) => {
    crxRequests += 1
    response.writeHead(200, {
      'content-type': 'application/x-chrome-extension',
      connection: 'close'
    })
    response.end(crx)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')
    const voyager = await launchVoyager({
      env: {
        VOYAGER_CHROME_WEB_STORE_ENDPOINT: `http://127.0.0.1:${address.port}/crx`
      }
    })

    await voyager.tab.route('https://chromewebstore.google.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Sea Foam Theme</h1><button disabled>Add to Chrome</button></body></html>'
      })
    )
    await voyager.navigate(STORE_URL)

    const installButton = voyager.tab.getByRole('button', { name: 'Add to Chrome' })
    await expect(installButton).toBeEnabled()
    await installButton.click()

    await expect
      .poll(() => voyager.chrome.evaluate(() => window.voyager.theme.get()))
      .toEqual(
        expect.objectContaining({ chrome: expect.objectContaining({ source: 'chrome-store' }) })
      )
    await expect
      .poll(() =>
        voyager.chrome.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--voyager-bg').trim()
        )
      )
      .toBe('#b2e0df')
    expect(crxRequests).toBeGreaterThan(0)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('start page URL carries per-profile appearance without privileged APIs', () => {
  const url = startPageUrl('brave', false, {
    profileId: 'default',
    colors: { ...defaultColors(false), foreground: '#ffffff', accent: '#4c8dff' },
    background: { kind: 'image', image: 'voyager://theme/default/frame.png' }
  })

  expect(url).toContain('engine=brave')
  expect(url).toContain('bg=image')
  expect(url).toContain('bgi=voyager%3A%2F%2Ftheme%2Fdefault%2Fframe.png')
})
