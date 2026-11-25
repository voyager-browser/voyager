import { constants, createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

interface ZipEntry {
  name: string
  content: Buffer
  /** Override the stored size to exercise declared-size validation. */
  declaredSize?: number
}

interface DeflatedEntry {
  name: string
  compressed: Buffer
  uncompressedSize: number
}

/** Minimal stored-entry ZIP writer for extension CRX test fixtures. */
export function storedZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const uncompressedSize = entry.declaredSize ?? entry.content.length
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(entry.content.length, 18)
    header.writeUInt32LE(uncompressedSize, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.content)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(entry.content.length, 20)
    directory.writeUInt32LE(uncompressedSize, 24)
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

/** ZIP writer for deflated entries whose stored size can deliberately lie. */
export function deflatedZip(entries: DeflatedEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(entry.compressed.length, 18)
    header.writeUInt32LE(entry.uncompressedSize, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.compressed)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(8, 10)
    directory.writeUInt32LE(entry.compressed.length, 20)
    directory.writeUInt32LE(entry.uncompressedSize, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)

    offset += header.length + name.length + entry.compressed.length
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

/** Minimal stored-entry ZIP writer using ZIP64 headers and end records. */
export function storedZip64(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')

    const localExtra = Buffer.alloc(20)
    localExtra.writeUInt16LE(0x0001, 0)
    localExtra.writeUInt16LE(12, 2)
    localExtra.writeBigUInt64LE(BigInt(entry.content.length), 4)
    localExtra.writeBigUInt64LE(BigInt(entry.content.length), 12)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(45, 4)
    header.writeUInt32LE(0xffffffff, 18)
    header.writeUInt32LE(0xffffffff, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(localExtra.length, 28)
    local.push(header, name, localExtra, entry.content)

    const centralExtra = Buffer.alloc(28)
    centralExtra.writeUInt16LE(0x0001, 0)
    centralExtra.writeUInt16LE(24, 2)
    centralExtra.writeBigUInt64LE(BigInt(entry.content.length), 4)
    centralExtra.writeBigUInt64LE(BigInt(entry.content.length), 12)
    centralExtra.writeBigUInt64LE(BigInt(offset), 20)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(45, 4)
    directory.writeUInt16LE(45, 6)
    directory.writeUInt32LE(0xffffffff, 20)
    directory.writeUInt32LE(0xffffffff, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(centralExtra.length, 30)
    directory.writeUInt32LE(0xffffffff, 42)
    central.push(directory, name, centralExtra)

    offset += header.length + name.length + localExtra.length + entry.content.length
  }

  const centralOffset = offset
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const zip64Offset = centralOffset + centralSize

  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(BigInt(entries.length), 24)
  zip64End.writeBigUInt64LE(BigInt(entries.length), 32)
  zip64End.writeBigUInt64LE(BigInt(centralSize), 40)
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(zip64Offset), 8)
  locator.writeUInt32LE(1, 16)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)

  return Buffer.concat([...local, ...central, zip64End, locator, end])
}

/** Wrap a ZIP archive in a minimal CRX2 header accepted by Voyager. */
export function crx2(zip: Buffer): Buffer {
  const header = Buffer.alloc(16)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  return Buffer.concat([header, zip])
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}

function varint(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0)
  return Buffer.from(bytes)
}

/** Protobuf length-delimited field (wire type 2). */
function protoField(number: number, value: Buffer): Buffer {
  return Buffer.concat([varint((number << 3) | 2), varint(value.length), value])
}

function idBytes(extensionId: string): Buffer {
  let hex = ''
  for (const letter of extensionId) {
    hex += (letter.toLowerCase().charCodeAt(0) - 97).toString(16)
  }
  return Buffer.from(hex, 'hex')
}

export interface TestCrxSigner {
  /** Chrome id derived from this key, used as the Web Store id in fixtures. */
  readonly extensionId: string
  readonly publicKeyHash: string
  readonly publicKeyDer: Buffer
  /** Sign a ZIP payload as a real CRX3 package. */
  sign(zip: Buffer, options?: { crxId?: string }): Buffer
}

/** Generate an RSA developer key for CRX3 fixtures; no key material is committed. */
export function createTestCrxSigner(): TestCrxSigner {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const digest = createHash('sha256').update(publicKeyDer).digest()
  let extensionId = ''
  for (let index = 0; index < 16; index += 1) {
    extensionId += String.fromCharCode(97 + (digest[index] >> 4))
    extensionId += String.fromCharCode(97 + (digest[index] & 0x0f))
  }

  return {
    extensionId,
    publicKeyHash: digest.toString('hex'),
    publicKeyDer,
    sign(zip, options) {
      const signedHeaderData = protoField(1, idBytes(options?.crxId ?? extensionId))
      const signedData = Buffer.concat([
        Buffer.from('CRX3 SignedData\0', 'ascii'),
        uint32(signedHeaderData.length),
        signedHeaderData,
        zip
      ])
      const signature = sign('sha256', signedData, {
        key: privateKey as KeyObject,
        padding: constants.RSA_PKCS1_PADDING
      })
      const proof = Buffer.concat([protoField(1, publicKeyDer), protoField(2, signature)])
      const header = Buffer.concat([protoField(2, proof), protoField(10000, signedHeaderData)])
      return Buffer.concat([
        Buffer.from('Cr24', 'ascii'),
        uint32(3),
        uint32(header.length),
        header,
        zip
      ])
    }
  }
}

let sharedSigner: TestCrxSigner | undefined

/** One generated key per test process keeps fixture setup cheap. */
export function testCrxSigner(): TestCrxSigner {
  sharedSigner ??= createTestCrxSigner()
  return sharedSigner
}

/** Sign a generated ZIP fixture with a valid CRX3 header. */
export function signedCrx(zip: Buffer, signer: TestCrxSigner = testCrxSigner()): Buffer {
  return signer.sign(zip)
}

/** Build a CRX with just a manifest, optionally declaring an update URL. */
export function extensionCrx(manifest: Record<string, unknown>): Buffer {
  return crx2(
    storedZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) }])
  )
}

/** Signed variant of extensionCrx for update/install identity tests. */
export function signedExtensionCrx(
  manifest: Record<string, unknown>,
  signer: TestCrxSigner = testCrxSigner()
): Buffer {
  return signedCrx(
    storedZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) }]),
    signer
  )
}
