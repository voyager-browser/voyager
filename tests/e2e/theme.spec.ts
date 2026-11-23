import { parseCrxTheme, parseThemeFiles } from '../../src/main/theme/chromeTheme'
import {
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
