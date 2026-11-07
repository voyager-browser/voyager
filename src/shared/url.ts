import { DEFAULT_NEW_TAB_URL } from './constants'

/** Heuristics for whether omnibox input is a URL or a search query. */

// An explicit scheme such as https://, about: or mailto:.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
// `example.com:8080` is a host and port, not a scheme with a numeric payload.
const HOST_PORT = /^[^/?#\s]+:\d+([/?#]|$)/

const LOCALHOST = /^localhost(:\d+)?([/?#]|$)/i
const IP_ADDRESS = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#]|$)/
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i

export function hasScheme(input: string): boolean {
  const trimmed = input.trim()
  if (HOST_PORT.test(trimmed)) return false
  return SCHEME.test(trimmed)
}

export function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return false
  return (
    hasScheme(trimmed) ||
    LOCALHOST.test(trimmed) ||
    IP_ADDRESS.test(trimmed) ||
    DOMAIN.test(trimmed)
  )
}

/** Turn omnibox text into a navigable URL, searching when it isn't one. */
export function resolveInput(input: string, searchUrlFor: (query: string) => string): string {
  const trimmed = input.trim()
  if (!isLikelyUrl(trimmed)) return searchUrlFor(trimmed)
  if (hasScheme(trimmed)) return trimmed
  // Local servers are usually plain HTTP; public hosts default to HTTPS.
  if (LOCALHOST.test(trimmed) || IP_ADDRESS.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

export function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Chrome-style address shown while the omnibox is idle: no scheme, no `www.`
 * prefix, and no trailing slash for a site root. The full URL is restored as
 * soon as the field is focused for editing.
 */
export function displayUrl(raw: string): string {
  const trimmed = raw.trim()
  if (isNewTab(trimmed)) return ''
  const parsed = safeParseUrl(trimmed)
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return trimmed
  }
  const host = parsed.host.replace(/^www\./i, '')
  const path = parsed.pathname === '/' ? '' : parsed.pathname
  return `${host}${path}${parsed.search}${parsed.hash}`
}

export type SecurityLevel = 'secure' | 'insecure' | 'neutral'

/** Coarse connection security for a URL, for the omnibox indicator. */
export function securityLevelFor(url: string): SecurityLevel {
  const parsed = safeParseUrl(url)
  if (!parsed) return 'neutral'
  if (parsed.protocol === 'https:' || parsed.protocol === 'file:') return 'secure'
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      host === '::1' ||
      host === '[::1]'
    ) {
      return 'secure'
    }
    return 'insecure'
  }
  return 'neutral'
}

/** Whether a URL represents the start page or an otherwise empty tab. */
export function isNewTab(url: string): boolean {
  return (
    url === '' ||
    url === 'about:blank' ||
    url === DEFAULT_NEW_TAB_URL ||
    url.startsWith(`${DEFAULT_NEW_TAB_URL}?`)
  )
}

/**
 * Build the internal start page URL. The search engine travels in the query
 * string so the page can render without access to privileged IPC APIs.
 */
export function startPageUrl(engine: string, incognito: boolean): string {
  const params = new URLSearchParams({ engine })
  if (incognito) params.set('incognito', '1')
  return `${DEFAULT_NEW_TAB_URL}?${params.toString()}`
}
