export type ProxyMode = 'system' | 'direct' | 'fixed_servers'
export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5'

export interface ProxyConfig {
  mode: ProxyMode
  scheme: ProxyScheme
  host: string
  port: number
  bypassRules: string
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  mode: 'system',
  scheme: 'http',
  host: '',
  port: 8080,
  bypassRules: '<local>'
}

export function isProxyMode(value: unknown): value is ProxyMode {
  return value === 'system' || value === 'direct' || value === 'fixed_servers'
}

export function isProxyScheme(value: unknown): value is ProxyScheme {
  return value === 'http' || value === 'https' || value === 'socks4' || value === 'socks5'
}

export function normalizeProxyPort(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(num)) return DEFAULT_PROXY_CONFIG.port
  const int = Math.trunc(num)
  if (int < 1 || int > 65535) return DEFAULT_PROXY_CONFIG.port
  return int
}

export function normalizeProxyHost(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^\[|\]$/g, '')
}

export function normalizeProxyBypassRules(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PROXY_CONFIG.bypassRules
  return value.trim()
}

/** Build Electron proxyRules for a fixed proxy server. */
export function proxyRulesFor(config: Pick<ProxyConfig, 'scheme' | 'host' | 'port'>): string {
  const host = normalizeProxyHost(config.host)
  const port = normalizeProxyPort(config.port)
  if (!host) return ''
  // Electron/Chromium proxy rules: scheme=host:port
  return `${config.scheme}=${host}:${port}`
}

export function normalizeProxyConfig(value: unknown): ProxyConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ProxyConfig>
  return {
    mode: isProxyMode(raw.mode) ? raw.mode : DEFAULT_PROXY_CONFIG.mode,
    scheme: isProxyScheme(raw.scheme) ? raw.scheme : DEFAULT_PROXY_CONFIG.scheme,
    host: normalizeProxyHost(raw.host),
    port: normalizeProxyPort(raw.port),
    bypassRules: normalizeProxyBypassRules(raw.bypassRules ?? DEFAULT_PROXY_CONFIG.bypassRules)
  }
}
