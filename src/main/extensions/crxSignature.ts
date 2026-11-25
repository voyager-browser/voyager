/**
 * Pure CRX3 signature verification for automatic updates. Electron's
 * loadExtension() accepts a directory, so Voyager unpacks CRX packages itself
 * and must check their signatures before trusting an update.
 */

import { constants, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'

const CRX_MAGIC = 'Cr24'
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'ascii')
const MAX_HEADER_BYTES = 1024 * 1024

/** The developer identity proven by a valid CRX3 signature. */
export interface CrxSigningIdentity {
  /** SHA-256 of the DER-encoded SubjectPublicKeyInfo, as hex. */
  publicKeyHash: string
  /** Extension id derived from the public key (32 letters a-p). */
  extensionId: string
}

export interface VerifiedCrx3 extends CrxSigningIdentity {
  /** Hex-encoded 16-byte crx_id carried in the signed header. */
  signedId: string
}

interface ProtobufField {
  number: number
  value: Buffer
}

interface CrxProof {
  algorithm: 'rsa' | 'ecdsa'
  publicKey: Buffer
  signature: Buffer
}

function readVarint(data: Buffer, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  while (offset < data.length && shift <= 32) {
    const byte = data[offset]
    offset += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, next: offset }
    shift += 7
  }
  throw new Error('The CRX3 header is corrupt.')
}

/** Read the length-delimited protobuf fields used by the CRX3 header. */
function readFields(data: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = []
  let offset = 0
  while (offset < data.length) {
    const tag = readVarint(data, offset)
    offset = tag.next
    const number = Math.floor(tag.value / 8)
    const wire = tag.value % 8
    if (wire === 2) {
      const length = readVarint(data, offset)
      offset = length.next
      if (offset + length.value > data.length) {
        throw new Error('The CRX3 header is corrupt.')
      }
      fields.push({ number, value: data.subarray(offset, offset + length.value) })
      offset += length.value
    } else if (wire === 0) {
      offset = readVarint(data, offset).next
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4
      if (offset > data.length) throw new Error('The CRX3 header is corrupt.')
    } else {
      throw new Error('The CRX3 header is corrupt.')
    }
  }
  return fields
}

function firstField(fields: ProtobufField[], number: number): Buffer | undefined {
  return fields.find((field) => field.number === number)?.value
}

/** Chromium maps each byte of SHA-256(SPKI)[0..16] to two letters a-p. */
export function deriveExtensionId(publicKeyDer: Buffer): string {
  const digest = createHash('sha256').update(publicKeyDer).digest()
  let id = ''
  for (let index = 0; index < 16; index += 1) {
    id += String.fromCharCode(97 + (digest[index] >> 4))
    id += String.fromCharCode(97 + (digest[index] & 0x0f))
  }
  return id
}

function extensionIdBytes(extensionId: string): Buffer {
  let hex = ''
  for (const letter of extensionId) {
    const nibble = letter.toLowerCase().charCodeAt(0) - 97
    if (!Number.isInteger(nibble) || nibble < 0 || nibble > 15) {
      throw new Error('The CRX3 header contains an invalid extension id.')
    }
    hex += nibble.toString(16)
  }
  if (hex.length !== 32) throw new Error('The CRX3 header contains an invalid extension id.')
  return Buffer.from(hex, 'hex')
}

function crx3Parts(file: Buffer): { header: Buffer; archive: Buffer } {
  if (file.length < 16 || file.toString('ascii', 0, 4) !== CRX_MAGIC) {
    throw new Error('The extension package is not a CRX file.')
  }
  if (file.readUInt32LE(4) !== 3) {
    throw new Error('The extension package is not a signed CRX3 file.')
  }
  const headerSize = file.readUInt32LE(8)
  if (headerSize === 0 || headerSize > MAX_HEADER_BYTES || 12 + headerSize > file.length) {
    throw new Error('The CRX3 header is invalid or truncated.')
  }
  const archive = file.subarray(12 + headerSize)
  if (archive.length < 2 || archive.toString('ascii', 0, 2) !== 'PK') {
    throw new Error('The CRX3 archive is missing or corrupt.')
  }
  return { header: file.subarray(12, 12 + headerSize), archive }
}

/**
 * Verify every CRX3 proof over the archive and return the developer identity.
 * Pass `expectedId` for Web Store or pinned-identity checks.
 */
export function verifyCrx3Signature(file: Buffer, expectedId?: string): VerifiedCrx3 {
  const { header, archive } = crx3Parts(file)
  const fields = readFields(header)
  const proofs: CrxProof[] = []
  let signedHeaderData: Buffer | undefined

  for (const field of fields) {
    if (field.number === 2 || field.number === 3) {
      const proofFields = readFields(field.value)
      const publicKey = firstField(proofFields, 1)
      const signature = firstField(proofFields, 2)
      if (!publicKey || !signature) {
        throw new Error('The CRX3 header has an incomplete signature proof.')
      }
      proofs.push({
        algorithm: field.number === 2 ? 'rsa' : 'ecdsa',
        publicKey,
        signature
      })
    } else if (field.number === 10000) {
      if (signedHeaderData) throw new Error('The CRX3 header has duplicate signed data.')
      signedHeaderData = field.value
    }
  }
  if (!signedHeaderData || proofs.length === 0) {
    throw new Error('The extension package is not a signed CRX3 package.')
  }

  const signedId = firstField(readFields(signedHeaderData), 1)
  if (!signedId || signedId.length !== 16) {
    throw new Error('The CRX3 signed data has no extension id.')
  }

  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32LE(signedHeaderData.length)
  const signedData = Buffer.concat([SIGNED_DATA_PREFIX, headerLength, signedHeaderData, archive])

  // Chromium verifies every proof. Only the developer proof's key hash must
  // match the signed crx_id; Web Store packs also carry store publisher keys.
  let developer: VerifiedCrx3 | undefined
  for (const proof of proofs) {
    let key: KeyObject
    try {
      key = createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' })
    } catch {
      throw new Error('The CRX3 header has an invalid public key.')
    }
    const valid =
      proof.algorithm === 'rsa'
        ? key.asymmetricKeyType === 'rsa' &&
          verify(
            'sha256',
            signedData,
            { key, padding: constants.RSA_PKCS1_PADDING },
            proof.signature
          )
        : key.asymmetricKeyType === 'ec' && verify('sha256', signedData, key, proof.signature)
    if (!valid) throw new Error('The extension package has an invalid CRX3 signature.')

    const extensionId = deriveExtensionId(proof.publicKey)
    if (!developer && signedId.equals(extensionIdBytes(extensionId))) {
      developer = {
        publicKeyHash: createHash('sha256').update(proof.publicKey).digest('hex'),
        extensionId,
        signedId: signedId.toString('hex')
      }
    }
  }
  if (!developer) {
    throw new Error('The CRX3 signed extension id does not match any signing key.')
  }
  if (expectedId && developer.extensionId !== expectedId.toLowerCase()) {
    throw new Error('The extension package was signed by a different developer.')
  }
  return developer
}

/** Best-effort identity for a user-supplied CRX; unsigned packages stay installable. */
export function crxSigningIdentity(file: Buffer): CrxSigningIdentity | null {
  try {
    const { publicKeyHash, extensionId } = verifyCrx3Signature(file)
    return { publicKeyHash, extensionId }
  } catch {
    return null
  }
}
