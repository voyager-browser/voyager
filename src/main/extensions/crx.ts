import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { inflateRawSync } from 'node:zlib'
import { isIllegalExtensionEntry, removeIllegalExtensionFiles } from './illegalFiles'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_FILES = 10_000
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

/** Strip the CRX2/CRX3 header and return the embedded ZIP archive. */
function crxArchive(file: Buffer): Buffer {
  if (file.length < 16 || file.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('The file is not a CRX extension package.')
  }
  const version = file.readUInt32LE(4)
  let offset: number
  if (version === 2) {
    offset = 16 + file.readUInt32LE(8) + file.readUInt32LE(12)
  } else if (version === 3) {
    if (file.length < 12) throw new Error('The CRX header is truncated.')
    offset = 12 + file.readUInt32LE(8)
  } else {
    throw new Error(`Unsupported CRX version ${version}; expected CRX2 or CRX3.`)
  }
  if (
    offset < 0 ||
    offset + 4 > file.length ||
    file.toString('ascii', offset, offset + 2) !== 'PK'
  ) {
    throw new Error('The CRX archive is missing or corrupt.')
  }
  return file.subarray(offset)
}

function endOfCentralDirectory(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - (0xffff + 22))
  for (let position = archive.length - 22; position >= minimum; position -= 1) {
    if (archive.readUInt32LE(position) !== EOCD_SIGNATURE) continue
    const commentLength = archive.readUInt16LE(position + 20)
    if (position + 22 + commentLength === archive.length) return position
  }
  throw new Error('The extension archive has no central directory.')
}

function safeExtractPath(destination: string, entryName: string): string | null {
  const normalized = entryName.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    return null
  }
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part.toLowerCase() === '..')) return null
  return resolve(destination, ...parts)
}

/** Extract a ZIP archive with a small, hardened reader (no new dependency). */
function extractArchive(archive: Buffer, destination: string): void {
  const eocd = endOfCentralDirectory(archive)
  const count = archive.readUInt16LE(eocd + 10)
  const centralSize = archive.readUInt32LE(eocd + 12)
  const centralOffset = archive.readUInt32LE(eocd + 16)
  if (centralOffset + centralSize > archive.length) {
    throw new Error('The extension archive has an invalid central directory.')
  }
  if (count > MAX_FILES) throw new Error('The extension archive has too many files.')

  let cursor = centralOffset
  let totalBytes = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('The extension archive has a corrupt file entry.')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const mode = (archive.readUInt32LE(cursor + 38) >>> 16) & 0o170000
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength

    if (
      flags & 0x1 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error('Encrypted and ZIP64 extensions are not supported.')
    }
    if (uncompressedSize > MAX_FILE_BYTES || totalBytes + uncompressedSize > MAX_TOTAL_BYTES) {
      throw new Error('The extension archive is too large.')
    }
    const target = safeExtractPath(destination, name)
    if (!target) throw new Error('The extension archive contains an unsafe file path.')
    if (isIllegalExtensionEntry(name)) continue
    if (mode === 0o120000 || mode === 0o140000) continue
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      continue
    }

    if (
      localOffset + 30 > archive.length ||
      archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
    ) {
      throw new Error('The extension archive has a corrupt file header.')
    }
    const dataStart =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28)
    if (dataStart + compressedSize > archive.length) {
      throw new Error('The extension archive is truncated.')
    }
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)
    const contents = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null
    if (!contents || contents.length !== uncompressedSize) {
      throw new Error('The extension archive could not be decompressed.')
    }
    totalBytes += contents.length
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, contents)
  }
}

/** Directory under userData where downloaded CRX packages are unpacked. */
export function unpackedExtensionsRoot(profileId: string): string {
  const safeProfile = profileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(app.getPath('userData'), 'unpacked-extensions', safeProfile)
}

/** Unpack a CRX file once and return the directory containing its manifest. */
export function unpackCrx(filePath: string, profileId: string): string {
  const file = readFileSync(resolve(filePath))
  const archive = crxArchive(file)
  const hash = createHash('sha256').update(file).digest('hex').slice(0, 24)
  const destination = join(unpackedExtensionsRoot(profileId), hash)
  if (existsSync(join(destination, 'manifest.json'))) {
    // Repair unpacks created before illegal metadata files were filtered.
    removeIllegalExtensionFiles(destination)
    return destination
  }

  mkdirSync(destination, { recursive: true })
  try {
    extractArchive(archive, destination)
    removeIllegalExtensionFiles(destination)
    return destination
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

/** Parse an extension id from a Chrome Web Store URL or a bare 32-character id. */
export function webStoreId(input: string): string {
  const value = input.trim()
  if (/^[a-p]{32}$/i.test(value)) return value.toLowerCase()

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a Chrome Web Store URL or a 32-character extension id.')
  }
  const host = url.hostname.toLowerCase()
  const isStore = host === 'chromewebstore.google.com' || host === 'chrome.google.com'
  if (url.protocol !== 'https:' || !isStore) {
    throw new Error('Only Chrome Web Store URLs are supported.')
  }
  const candidate =
    url.pathname.split('/').find((part) => /^[a-p]{32}$/i.test(part)) ?? url.searchParams.get('id')
  if (!candidate || !/^[a-p]{32}$/i.test(candidate)) {
    throw new Error('The Chrome Web Store URL does not contain an extension id.')
  }
  return candidate.toLowerCase()
}

/** Download a CRX from Google's update service and return its temporary path. */
export async function downloadWebStoreCrx(id: string): Promise<string> {
  // Google's update service answers 204 No Content when the request looks too
  // much like an old Chrome client. `installsource=ondemand` and a current
  // Chromium version are required to get the CRX redirect for Web Store ids.
  const params = new URLSearchParams({
    response: 'redirect',
    prod: 'chromecrx',
    prodversion: process.versions.chrome || '141.0.0.0',
    acceptformat: 'crx2,crx3',
    x: `id=${id}&installsource=ondemand&uc`
  })
  const url = `https://clients2.google.com/service/update2/crx?${params.toString()}`
  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new Error('Could not reach the Chrome Web Store. Check your connection and try again.')
  }
  if (!response.ok) {
    throw new Error(`The Chrome Web Store returned HTTP ${response.status} for ${id}.`)
  }
  const file = Buffer.from(await response.arrayBuffer())
  if (file.length === 0 || file.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('The Chrome Web Store did not return an extension package for this id.')
  }
  crxArchive(file)
  const temporaryPath = join(tmpdir(), `voyager-extension-${randomUUID()}.crx`)
  writeFileSync(temporaryPath, file)
  return temporaryPath
}

/**
 * Download a CRX referenced by an extension update manifest. The optional
 * SHA-256 check uses the hash advertised by the update service when present.
 */
export async function downloadCrx(url: string, expectedSha256?: string): Promise<string> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Error('The extension update URL is invalid.')
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('Only HTTP(S) extension update URLs are supported.')
  }

  const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`The extension update returned HTTP ${response.status}.`)
  const file = Buffer.from(await response.arrayBuffer())
  if (file.length === 0 || file.length > MAX_DOWNLOAD_BYTES) {
    throw new Error('The extension update package is invalid or too large.')
  }
  if (file.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('The extension update is not a CRX package.')
  }
  crxArchive(file)
  if (expectedSha256) {
    const actual = createHash('sha256').update(file).digest('hex')
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error('The extension update failed its integrity check.')
    }
  }

  const temporaryPath = join(tmpdir(), `voyager-extension-update-${randomUUID()}.crx`)
  writeFileSync(temporaryPath, file)
  return temporaryPath
}
