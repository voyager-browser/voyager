import { X509Certificate } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { connect, type DetailedPeerCertificate } from 'node:tls'
import { dialog } from 'electron'
import type {
  CertificateChainEntry,
  CertificateDetails,
  CertificateExportFormat
} from '../../shared/types'

/** Certificates change rarely; cache successful lookups briefly per host. */
const CACHE_TTL_MS = 60_000
const CONNECT_TIMEOUT_MS = 8_000

interface CachedCertificate {
  fetchedAt: number
  details: CertificateDetails
  der: Buffer
}

const cache = new Map<string, CachedCertificate>()

function hostKey(url: URL): string | null {
  if (url.protocol !== 'https:') return null
  const port = url.port || '443'
  return `${url.hostname}:${port}`
}

/** One-line representation of a distinguished name. */
function formatName(value: string): string {
  return value
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

const KEY_USAGE_LABELS: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
  '1.3.6.1.5.5.7.3.3': 'Code Signing',
  '1.3.6.1.5.5.7.3.4': 'Email Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  '2.5.29.37.0': 'Any Extended Key Usage'
}

function formatKeyUsage(keyUsage: string[] | undefined): string {
  if (!keyUsage || keyUsage.length === 0) return ''
  return keyUsage.map((usage) => KEY_USAGE_LABELS[usage] ?? usage).join(', ')
}

function publicKeyDescription(x509: X509Certificate): string {
  const key = x509.publicKey
  const type = key.asymmetricKeyType ?? 'unknown'
  const details = key.asymmetricKeyDetails ?? {}
  const size =
    'modulusLength' in details && typeof details.modulusLength === 'number'
      ? `${details.modulusLength}-bit`
      : 'namedCurve' in details && typeof details.namedCurve === 'string'
        ? details.namedCurve
        : ''
  return [type.toUpperCase(), size].filter(Boolean).join(' ')
}

function chainFromPeer(peer: DetailedPeerCertificate): DetailedPeerCertificate[] {
  const chain: DetailedPeerCertificate[] = []
  const seen = new Set<string>()
  let current: DetailedPeerCertificate | undefined = peer
  while (current && Buffer.isBuffer(current.raw) && current.raw.length > 0) {
    const fingerprint = current.fingerprint256
    if (seen.has(fingerprint)) break
    seen.add(fingerprint)
    chain.push(current)
    current = current.issuerCertificate
  }
  return chain
}

function chainEntry(certificate: DetailedPeerCertificate): CertificateChainEntry {
  const x509 = new X509Certificate(certificate.raw)
  return {
    subject: formatName(x509.subject),
    issuer: formatName(x509.issuer),
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    fingerprint256: x509.fingerprint256,
    isCA: x509.ca
  }
}

function readPeerCertificate(
  socket: import('node:tls').TLSSocket,
  url: URL
): CachedCertificate | null {
  const peer = socket.getPeerCertificate(true)
  if (!Buffer.isBuffer(peer.raw) || peer.raw.length === 0) return null

  const x509 = new X509Certificate(peer.raw)
  const chain = chainFromPeer(peer).map(chainEntry)
  const details: CertificateDetails = {
    url: url.toString(),
    host: url.host,
    subject: formatName(x509.subject),
    issuer: formatName(x509.issuer),
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    serialNumber: x509.serialNumber,
    fingerprint: x509.fingerprint,
    fingerprint256: x509.fingerprint256,
    fingerprint512: x509.fingerprint512,
    publicKey: publicKeyDescription(x509),
    subjectAltName: x509.subjectAltName ?? '',
    keyUsage: formatKeyUsage(x509.keyUsage),
    isCA: x509.ca,
    chain,
    pem: x509.toString()
  }

  return { fetchedAt: Date.now(), details, der: Buffer.from(x509.raw) }
}

/**
 * Open a short-lived TLS connection and read the certificate chain. This is
 * deliberately independent of Chromium's own connection: it runs only when the
 * user asks for certificate details, so page loads are never delayed.
 */
async function fetchCertificate(url: URL): Promise<CachedCertificate | null> {
  const host = url.hostname
  const port = Number(url.port || 443)

  return new Promise((resolve) => {
    let settled = false
    const finish = (value: CachedCertificate | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    const socket = connect({
      host,
      port,
      servername: isIP(host) === 0 ? host : undefined,
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
      timeout: CONNECT_TIMEOUT_MS
    })

    socket.once('secureConnect', () => {
      try {
        finish(readPeerCertificate(socket, url))
      } catch {
        finish(null)
      }
    })
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
  })
}

async function certificateFor(url: string): Promise<CachedCertificate | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const key = hostKey(parsed)
  if (!key) return null

  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached

  const fetched = await fetchCertificate(parsed)
  if (fetched) cache.set(key, fetched)
  return fetched
}

/** Read the certificate served by an HTTPS URL, or null when unavailable. */
export async function getCertificate(url: string): Promise<CertificateDetails | null> {
  const certificate = await certificateFor(url)
  return certificate?.details ?? null
}

/**
 * Export the leaf certificate after asking the user where to save it. Returns
 * the saved path, or null when the dialog was cancelled or the fetch failed.
 */
export async function exportCertificate(
  url: string,
  format: CertificateExportFormat
): Promise<string | null> {
  const certificate = await certificateFor(url)
  if (!certificate) return null
  if (format !== 'pem' && format !== 'der') throw new Error('Unsupported certificate format')

  const extension = format === 'pem' ? 'pem' : 'cer'
  const result = await dialog.showSaveDialog({
    title: 'Export certificate',
    defaultPath: `${certificate.details.host.replace(/[^a-z0-9.-]+/gi, '_')}.${extension}`,
    filters: [
      {
        name: format === 'pem' ? 'PEM certificate' : 'DER certificate',
        extensions: [extension]
      }
    ]
  })
  if (result.canceled || !result.filePath) return null

  const data = format === 'pem' ? certificate.details.pem : certificate.der
  await writeFile(result.filePath, data)
  return result.filePath
}
