/**
 * Chrome theme artifact parsing. CRX2/CRX3 files are ZIP archives with a small
 * binary header; raw imports can supply manifest.json plus image files. This
 * module intentionally has no Electron imports so the parsing rules are
 * testable in isolation.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { deriveChromeThemeColors } from '../../shared/theme'
import type { BrowserThemeColors, BrowserThemeSource, ThemeFileInput } from '../../shared/types'

const ZIP_LOCAL_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_END_SIGNATURE = 0x06054b50
const MAX_ARCHIVE_FILES = 512
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
}

export interface ThemeImageArtifact {
  /** Stored file name suggested by the artifact, used to pick an extension. */
  name: string
  mimeType: string
  data: Uint8Array
}

export interface ChromeThemeArtifact {
  name: string
  version?: string
  source: BrowserThemeSource
  colors: BrowserThemeColors
  image?: ThemeImageArtifact
}

interface ArchiveFile {
  path: string
  data: Uint8Array
}

function hasMagic(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (offset + magic.length > bytes.length) return false
  return magic.every((byte, index) => bytes[offset + index] === byte)
}

const CRX_MAGIC = [0x43, 0x72, 0x32, 0x34] as const // "Cr24"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const // "PK\x03\x04"

/** Strip the CRX2/CRX3 header and return the embedded ZIP bytes. */
function crxToZip(bytes: Uint8Array): Uint8Array {
  if (!hasMagic(bytes, CRX_MAGIC)) throw new Error('Not a Chrome extension (.crx) file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 12) throw new Error('Truncated Chrome extension file')
  const version = view.getUint32(4, true)
  let start: number
  if (version === 2) {
    if (bytes.byteLength < 16) throw new Error('Truncated CRX2 header')
    const keyLength = view.getUint32(8, true)
    const signatureLength = view.getUint32(12, true)
    start = 16 + keyLength + signatureLength
  } else if (version === 3) {
    const headerLength = view.getUint32(8, true)
    start = 12 + headerLength
    // The protobuf header length is authoritative, but tolerate a small
    // padding mismatch rather than rejecting otherwise valid packs.
    if (!hasMagic(bytes, ZIP_MAGIC, start)) {
      for (
        let candidate = start;
        candidate < Math.min(start + 8192, bytes.length);
        candidate += 1
      ) {
        if (hasMagic(bytes, ZIP_MAGIC, candidate)) {
          start = candidate
          break
        }
      }
    }
  } else {
    throw new Error(`Unsupported CRX version: ${version}`)
  }
  if (start < 0 || start >= bytes.length || !hasMagic(bytes, ZIP_MAGIC, start)) {
    throw new Error('Chrome extension archive is missing its ZIP payload')
  }
  return bytes.subarray(start)
}

function normalizeEntryPath(raw: string): string | null {
  const path = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path || path.split('/').includes('..') || path.includes('\0')) return null
  return path
}

/** Read a stored/deflated ZIP using its central directory (no extra deps). */
function unzip(bytes: Uint8Array): ArchiveFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!hasMagic(bytes, ZIP_MAGIC)) throw new Error('Unsupported archive payload')

  let end = -1
  const minimum = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('Invalid archive: end of central directory not found')

  const entryCount = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  if (entryCount > MAX_ARCHIVE_FILES || offset + 46 > bytes.byteLength) {
    throw new Error('Invalid archive: too many entries or bad central directory')
  }

  const decoder = new TextDecoder()
  const files: ArchiveFile[] = []
  let totalBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('Invalid archive: corrupt central directory entry')
    }
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const path = normalizeEntryPath(
      decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    )
    offset += 46 + nameLength + extraLength + commentLength

    if (!path || files.length >= MAX_ARCHIVE_FILES) continue
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      compressedSize > MAX_FILE_BYTES ||
      uncompressedSize > MAX_FILE_BYTES ||
      totalBytes + uncompressedSize > MAX_TOTAL_BYTES
    ) {
      throw new Error('Archive contains an unreasonably large file')
    }
    if (
      localOffset + 30 > bytes.byteLength ||
      view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE
    ) {
      throw new Error('Invalid archive: corrupt local file header')
    }
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const endOfData = dataStart + compressedSize
    if (endOfData > bytes.byteLength) throw new Error('Invalid archive: truncated file data')

    const compressed = bytes.subarray(dataStart, endOfData)
    let data: Uint8Array
    if (method === 0) {
      data = compressed
    } else if (method === 8) {
      try {
        data = inflateRawSync(compressed, {
          maxOutputLength: Math.min(uncompressedSize, MAX_TOTAL_BYTES - totalBytes)
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
        ) {
          throw new Error('Invalid archive: file exceeds the decompression budget', {
            cause: error
          })
        }
        throw error
      }
    } else {
      continue
    }
    if (data.byteLength !== uncompressedSize || data.byteLength > MAX_FILE_BYTES) {
      throw new Error('Invalid archive: file size mismatch')
    }
    totalBytes += data.byteLength
    files.push({ path, data })
  }
  return files
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data).replace(/^\uFEFF/, '')
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
}

function imageType(name: string): string | null {
  const extension = baseName(name).split('.').pop() ?? ''
  return IMAGE_MIME_TYPES[extension] ?? null
}

/** True when a manifest declares a Chrome theme section. */
function hasThemeSection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const theme = (value as Record<string, unknown>).theme
  return !!theme && typeof theme === 'object' && !Array.isArray(theme)
}

interface ManifestInfo {
  name: string
  version?: string
  colors: BrowserThemeColors
  imagePaths: string[]
}

/** Convert a Chrome extension manifest into Voyager's theme colors and assets. */
function readManifest(value: unknown, dark: boolean): ManifestInfo {
  if (!value || typeof value !== 'object') throw new Error('Theme manifest must be a JSON object')
  const manifest = value as Record<string, any>
  const theme = manifest.theme
  if (!theme || typeof theme !== 'object') {
    throw new Error('Selected file is not a Chrome theme (no theme section)')
  }
  const images: Record<string, unknown> =
    theme.images && typeof theme.images === 'object' ? theme.images : {}
  const imagePaths: string[] = []
  for (const value of Object.values(images)) {
    if (typeof value === 'string') imagePaths.push(value)
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string') imagePaths.push(entry)
    }
  }
  return {
    name:
      typeof manifest.name === 'string' && manifest.name.trim()
        ? manifest.name.trim()
        : 'Imported Chrome theme',
    ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
    colors: deriveChromeThemeColors(theme.colors, dark),
    imagePaths
  }
}

function pickImage(
  imagePaths: string[],
  images: ThemeImageArtifact[]
): ThemeImageArtifact | undefined {
  const candidates = imagePaths.map(normalizeEntryPath).filter((path): path is string => !!path)
  for (const path of candidates) {
    const wanted = baseName(path)
    const match = images.find((image) => baseName(image.name) === wanted)
    if (match) return match
  }
  return images[0]
}

function asArtifact(
  info: ManifestInfo,
  source: BrowserThemeSource,
  image?: ThemeImageArtifact
): ChromeThemeArtifact {
  return {
    name: info.name,
    ...(info.version ? { version: info.version } : {}),
    source,
    colors: info.colors,
    ...(image ? { image } : {})
  }
}

/** Convert a parsed Chrome manifest into a Voyager theme artifact. */
export function parseThemeManifest(
  value: unknown,
  dark: boolean,
  images: ThemeImageArtifact[] = [],
  source: BrowserThemeSource = 'chrome-manifest'
): ChromeThemeArtifact {
  const info = readManifest(value, dark)
  return asArtifact(info, source, pickImage(info.imagePaths, images))
}

/** Read a Chrome theme from an already unpacked extension directory. */
export function readThemeDirectory(
  path: string,
  dark: boolean,
  source: BrowserThemeSource = 'chrome-extension'
): ChromeThemeArtifact | null {
  const root = resolve(path)
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Installed extension manifest is not valid JSON')
  }
  if (!hasThemeSection(parsed)) return null

  const info = readManifest(parsed, dark)
  const images: ThemeImageArtifact[] = []
  for (const rawPath of info.imagePaths) {
    const relative = normalizeEntryPath(rawPath)
    if (!relative) continue
    const imagePath = resolve(root, relative)
    if (imagePath === root || !imagePath.startsWith(root + sep)) continue
    const mimeType = imageType(relative)
    if (!mimeType) continue
    let data: Buffer
    try {
      data = readFileSync(imagePath)
    } catch {
      continue
    }
    if (data.byteLength === 0 || data.byteLength > MAX_FILE_BYTES) continue
    images.push({ name: relative, mimeType, data: new Uint8Array(data) })
  }
  return asArtifact(info, source, pickImage(info.imagePaths, images))
}

/** Parse a `.crx`, `.zip` or CRX bytes supplied under any file name. */
export function parseCrxTheme(bytes: Uint8Array, dark: boolean): ChromeThemeArtifact {
  if (bytes.byteLength > MAX_TOTAL_BYTES) throw new Error('Theme archive is too large')
  const payload = hasMagic(bytes, CRX_MAGIC) ? crxToZip(bytes) : bytes
  const files = unzip(payload)
  const manifestFile =
    files.find((file) => file.path.toLowerCase() === 'manifest.json') ??
    files.find((file) => baseName(file.path) === 'manifest.json')
  if (!manifestFile) throw new Error('Theme archive has no manifest.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUtf8(manifestFile.data))
  } catch {
    throw new Error('Theme manifest is not valid JSON')
  }
  const images: ThemeImageArtifact[] = []
  for (const file of files) {
    const mimeType = imageType(file.path)
    if (mimeType) images.push({ name: file.path, mimeType, data: file.data })
  }
  return parseThemeManifest(parsed, dark, images, 'chrome-crx')
}

/**
 * Parse a set of loose files: one manifest.json (or a single JSON file) plus
 * any referenced images. Missing images still yield a usable color theme.
 */
export function parseThemeFiles(files: ThemeFileInput[], dark: boolean): ChromeThemeArtifact {
  if (files.length === 0) throw new Error('Select a Chrome theme file first')
  const crx = files.find((file) => /\.(crx|zip)$/i.test(file.name))
  if (crx) return parseCrxTheme(Buffer.from(crx.data, 'base64'), dark)

  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name))
  const manifestFile =
    jsonFiles.find((file) => baseName(file.name) === 'manifest.json') ?? jsonFiles[0]
  if (!manifestFile) throw new Error('Select a Chrome theme .crx, .zip or manifest.json file')
  if (manifestFile.data.length > MAX_FILE_BYTES * 2) {
    throw new Error('Theme manifest is too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(manifestFile.data, 'base64').toString('utf8'))
  } catch {
    throw new Error('Theme manifest is not valid JSON')
  }
  const images: ThemeImageArtifact[] = []
  for (const file of files) {
    const mimeType = imageType(file.name)
    if (!mimeType) continue
    const data = Buffer.from(file.data, 'base64')
    if (data.byteLength > MAX_FILE_BYTES) throw new Error('Theme image is too large')
    images.push({ name: file.name, mimeType, data })
  }
  return parseThemeManifest(parsed, dark, images)
}
