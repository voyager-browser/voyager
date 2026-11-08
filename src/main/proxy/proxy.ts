import type { Session } from 'electron'
import {
  DEFAULT_PROXY_CONFIG,
  isProxyMode,
  isProxyScheme,
  normalizeProxyBypassRules,
  normalizeProxyConfig,
  normalizeProxyHost,
  normalizeProxyPort,
  proxyRulesFor,
  type ProxyConfig
} from '../../shared/proxy'
import { getSettings } from '../store'

export function proxyConfigForProfile(profileId: string): ProxyConfig {
  return normalizeProxyConfig({
    mode: getSettings(profileId, 'proxyMode', DEFAULT_PROXY_CONFIG.mode),
    scheme: getSettings(profileId, 'proxyScheme', DEFAULT_PROXY_CONFIG.scheme),
    host: getSettings(profileId, 'proxyHost', DEFAULT_PROXY_CONFIG.host),
    port: getSettings(profileId, 'proxyPort', DEFAULT_PROXY_CONFIG.port),
    bypassRules: getSettings(profileId, 'proxyBypassRules', DEFAULT_PROXY_CONFIG.bypassRules)
  })
}

/** Apply the profile's persisted proxy settings to an Electron session. */
export async function applyProxyForProfile(ses: Session, profileId: string): Promise<void> {
  const config = proxyConfigForProfile(profileId)
  await applyProxyConfig(ses, config)
}

export async function applyProxyConfig(ses: Session, config: ProxyConfig): Promise<void> {
  if (config.mode === 'direct') {
    await ses.setProxy({ mode: 'direct' })
    return
  }
  if (config.mode === 'system') {
    await ses.setProxy({ mode: 'system' })
    return
  }
  // fixed_servers
  const proxyRules = proxyRulesFor(config)
  if (!proxyRules) {
    // Incomplete manual config: fall back to system to avoid a broken network state.
    await ses.setProxy({ mode: 'system' })
    return
  }
  await ses.setProxy({
    mode: 'fixed_servers',
    proxyRules,
    proxyBypassRules: normalizeProxyBypassRules(config.bypassRules)
  })
}

export { isProxyMode, isProxyScheme, normalizeProxyHost, normalizeProxyPort, normalizeProxyBypassRules }
