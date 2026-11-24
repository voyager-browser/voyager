import { isIP } from 'node:net'

/**
 * Resolve the host and SNI name for a direct TLS connection to a URL.
 *
 * `URL.hostname` keeps IPv6 literals bracketed, but DNS and SNI require the
 * bare address. A bracketed hostname is always an IP literal, so it never gets
 * a server name either.
 */
export function tlsConnectionTarget(hostname: string): {
  host: string
  servername: string | undefined
} {
  const bracketed = hostname.startsWith('[') && hostname.endsWith(']')
  const host = bracketed ? hostname.slice(1, -1) : hostname
  return {
    host,
    servername: bracketed || isIP(host) !== 0 ? undefined : host
  }
}
