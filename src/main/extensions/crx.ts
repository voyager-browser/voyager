import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { inflateRawSync } from 'node:zlib'
import { crxSigningIdentity, verifyCrx3Signature, type CrxSigningIdentity } from './crxSignature'
import { isIllegalExtensionEntry, removeIllegalExtensionFiles } from './illegalFiles'

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const ZIP64_EXTRA_ID = 0x0001
const UINT32_MAX = 0xffffffff
/** Firm extraction limits, large enough for the >64 MiB CRX used by E2E. */
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = MAX_TOTAL_BYTES

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

/** Read a ZIP64 64-bit value, rejecting values JavaScript cannot address. */
function readUInt64(archive: Buffer, offset: number): number {
  const value = archive.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The extension archive uses offsets too large for this platform.')
  }
  return Number(value)
}

interface CentralDirectory {
  count: number
  size: number
  offset: number
}

function centralDirectory(archive: Buffer): CentralDirectory {
  const eocd = endOfCentralDirectory(archive)
  let count = archive.readUInt16LE(eocd + 10)
  let size = archive.readUInt32LE(eocd + 12)
  let offset = archive.readUInt32LE(eocd + 16)

  const locator = eocd - 20
  if (locator >= 0 && archive.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
    const zip64 = readUInt64(archive, locator + 8)
    if (zip64 + 56 > archive.length || archive.readUInt32LE(zip64) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('The extension archive has an invalid ZIP64 end record.')
    }
    if (readUInt64(archive, zip64 + 4) < 44) {
      throw new Error('The extension archive has an invalid ZIP64 end record.')
    }
    count = readUInt64(archive, zip64 + 32)
    size = readUInt64(archive, zip64 + 40)
    offset = readUInt64(archive, zip64 + 48)
  } else if (size === UINT32_MAX || offset === UINT32_MAX) {
    throw new Error('The extension archive is missing its ZIP64 locator.')
  }

  if (offset < 0 || size < 0 || count < 0 || offset + size > archive.length) {
    throw new Error('The extension archive has an invalid central directory.')
  }
  if (count > MAX_ARCHIVE_ENTRIES) {
    throw new Error('The extension archive has too many entries.')
  }
  return { count, size, offset }
}

function isBufferTooLarge(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
}

function inflateWithinBudget(compressed: Buffer, maxOutputLength: number): Buffer {
  try {
    return inflateRawSync(compressed, { maxOutputLength })
  } catch (error) {
    if (isBufferTooLarge(error)) {
      throw new Error('The extension archive exceeds the extraction budget.', { cause: error })
    }
    throw error
  }
}

type Zip64Field = 'uncompressed' | 'compressed' | 'offset'

/** Read only the ZIP64 values whose classic header fields use sentinels. */
function zip64Extra(
  archive: Buffer,
  start: number,
  length: number,
  fields: Zip64Field[]
): Partial<Record<Zip64Field, number>> {
  let cursor = start
  const end = start + length
  while (cursor + 4 <= end) {
    const id = archive.readUInt16LE(cursor)
    const size = archive.readUInt16LE(cursor + 2)
    cursor += 4
    if (cursor + size > end) throw new Error('The extension archive has a corrupt extra field.')
    if (id === ZIP64_EXTRA_ID) {
      const needed = fields.length * 8
      if (size < needed) {
        throw new Error('The extension archive has an incomplete ZIP64 extra field.')
      }
      const result: Partial<Record<Zip64Field, number>> = {}
      fields.forEach((field, index) => {
        result[field] = readUInt64(archive, cursor + index * 8)
      })
      return result
    }
    cursor += size
  }
  throw new Error('The extension archive is missing ZIP64 size information.')
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
  const directory = centralDirectory(archive)
  const centralEnd = directory.offset + directory.size
  let cursor = directory.offset
  let written = 0

  for (let index = 0; index < directory.count; index += 1) {
    if (cursor + 46 > centralEnd || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('The extension archive has a corrupt file entry.')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const mode = (archive.readUInt32LE(cursor + 38) >>> 16) & 0o170000
    let compressedSize = archive.readUInt32LE(cursor + 20)
    let uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    let localOffset = archive.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameLength + extraLength + commentLength > centralEnd) {
      throw new Error('The extension archive has a corrupt file entry.')
    }
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const extraStart = cursor + 46 + nameLength
    cursor = extraStart + extraLength + commentLength

    if (flags & 0x1) throw new Error('Encrypted extension archives are not supported.')

    const zip64Fields: Zip64Field[] = []
    if (uncompressedSize === UINT32_MAX) zip64Fields.push('uncompressed')
    if (compressedSize === UINT32_MAX) zip64Fields.push('compressed')
    if (localOffset === UINT32_MAX) zip64Fields.push('offset')
    if (zip64Fields.length > 0) {
      const values = zip64Extra(archive, extraStart, extraLength, zip64Fields)
      uncompressedSize = values.uncompressed ?? uncompressedSize
      compressedSize = values.compressed ?? compressedSize
      localOffset = values.offset ?? localOffset
    }
    if (
      compressedSize < 0 ||
      uncompressedSize < 0 ||
      localOffset < 0 ||
      localOffset + 30 > archive.length
    ) {
      throw new Error('The extension archive has invalid file sizes or offsets.')
    }

    const target = safeExtractPath(destination, name)
    if (!target) throw new Error('The extension archive contains an unsafe file path.')
    if (isIllegalExtensionEntry(name)) continue
    if (mode === 0o120000 || mode === 0o140000) continue
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      continue
    }

    const remaining = MAX_TOTAL_BYTES - written
    if (
      compressedSize > MAX_DOWNLOAD_BYTES ||
      uncompressedSize > MAX_ENTRY_BYTES ||
      uncompressedSize > remaining
    ) {
      throw new Error('The extension archive exceeds the extraction budget.')
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
    const contents =
      method === 0
        ? compressed
        : method === 8
          ? inflateWithinBudget(compressed, Math.min(uncompressedSize, remaining))
          : null
    if (!contents || contents.length !== uncompressedSize) {
      throw new Error('The extension archive could not be decompressed.')
    }
    if (written + contents.length > MAX_TOTAL_BYTES) {
      throw new Error('The extension archive exceeds the extraction budget.')
    }
    written += contents.length
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, contents)
  }
}

/** Directory under userData where downloaded CRX packages are unpacked. */
export function unpackedExtensionsRoot(profileId: string): string {
  const safeProfile = profileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(app.getPath('userData'), 'unpacked-extensions', safeProfile)
}

/**
 * Chromium derives a signed extension's id from the CRX public key. Electron
 * loads directories, so the extracted manifest needs that key to keep the
 * Web Store id; otherwise native host allowlists and update feeds stop matching.
 */
function restoreManifestKey(directory: string, publicKeyBase64: string): void {
  const manifestPath = join(directory, 'manifest.json')
  if (!existsSync(manifestPath)) return
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const manifest = parsed as Record<string, unknown>
    if (manifest.key === publicKeyBase64) return
    manifest.key = publicKeyBase64
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  } catch {
    // A corrupt manifest is reported by the normal extension loader.
  }
}

/** Unpack a CRX file once and return the directory containing its manifest. */
export function unpackCrx(filePath: string, profileId: string): string {
  const file = readFileSync(resolve(filePath))
  const archive = crxArchive(file)
  const identity = crxSigningIdentity(file)
  const hash = createHash('sha256').update(file).digest('hex').slice(0, 24)
  const destination = join(unpackedExtensionsRoot(profileId), hash)
  if (existsSync(join(destination, 'manifest.json'))) {
    // Repair unpacks created before illegal metadata files were filtered or
    // before the signed CRX key was restored into the manifest.
    removeIllegalExtensionFiles(destination)
    if (identity?.publicKeyBase64) restoreManifestKey(destination, identity.publicKeyBase64)
    return destination
  }

  mkdirSync(destination, { recursive: true })
  try {
    extractArchive(archive, destination)
    removeIllegalExtensionFiles(destination)
    if (identity?.publicKeyBase64) restoreManifestKey(destination, identity.publicKeyBase64)
    return destination
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

/** Best-effort CRX3 identity for a user-selected package; null if unsigned. */
export function readCrxSigningIdentity(filePath: string): CrxSigningIdentity | null {
  try {
    return crxSigningIdentity(readFileSync(resolve(filePath)))
  } catch {
    return null
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
  if (file.length === 0 || file.length > MAX_DOWNLOAD_BYTES) {
    throw new Error('The Chrome Web Store did not return a usable extension package.')
  }
  if (file.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('The Chrome Web Store did not return an extension package for this id.')
  }
  // The store redirects to a signed CRX3; a package for a different id must
  // never be installed under this id.
  verifyCrx3Signature(file, id)
  crxArchive(file)
  const temporaryPath = join(tmpdir(), `voyager-extension-${randomUUID()}.crx`)
  writeFileSync(temporaryPath, file)
  return temporaryPath
}

/** Identity an automatic update must prove before its files replace an install. */
export interface RequiredCrxIdentity {
  publicKeyHash?: string
  extensionId?: string
}

/**
 * Download a CRX referenced by an extension update manifest. The SHA-256
 * advertised by the update service is only an extra integrity check: the
 * CRX3 signature is what proves the update came from the original developer.
 */
export async function downloadCrx(
  url: string,
  expectedSha256?: string,
  requiredIdentity?: RequiredCrxIdentity
): Promise<string> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Error('The extension update URL is invalid.')
  }
  if (target.protocol !== 'https:') {
    throw new Error('Only HTTPS extension update URLs are supported.')
  }

  const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`The extension update returned HTTP ${response.status}.`)
  let finalUrl: URL
  try {
    finalUrl = new URL(response.url || target.toString())
  } catch {
    throw new Error('The extension update returned an invalid URL.')
  }
  if (finalUrl.protocol !== 'https:') {
    throw new Error('The extension update redirected to an insecure URL.')
  }
  const file = Buffer.from(await response.arrayBuffer())
  if (file.length === 0 || file.length > MAX_DOWNLOAD_BYTES) {
    throw new Error('The extension update package is invalid or too large.')
  }
  if (file.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('The extension update is not a CRX package.')
  }
  const identity = verifyCrx3Signature(file, requiredIdentity?.extensionId)
  if (
    requiredIdentity?.publicKeyHash &&
    identity.publicKeyHash.toLowerCase() !== requiredIdentity.publicKeyHash.toLowerCase()
  ) {
    throw new Error('The extension update was signed by a different developer.')
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
