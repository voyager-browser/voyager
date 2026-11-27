import type { EventEmitter } from 'node:events'
import { app, webContents as electronWebContents, type Session, type WebContents } from 'electron'
import { sessionForProfile } from '../../profiles/session'
import { applyProxyConfig, proxyConfigForProfile } from '../../proxy/proxy'
import { getSettings, setSettings } from '../../store'
import {
  DEFAULT_PROXY_CONFIG,
  isProxyMode,
  isProxyScheme,
  normalizeProxyBypassRules,
  normalizeProxyConfig,
  normalizeProxyHost,
  normalizeProxyPort,
  type ProxyConfig
} from '../../../shared/proxy'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { deleteApiSetting, getApiSetting, setApiSetting } from './storage'

const OWNER_KEY = 'proxy:owner'

const trackedSessions = new WeakMap<Session, string>()
const watched = new WeakSet<WebContents>()
let appListenerAttached = false

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function parseProxyServer(value: unknown): Partial<ProxyConfig> | null {
  const server = record(value)
  const host = normalizeProxyHost(server.host)
  if (!host) return null
  return {
    scheme: isProxyScheme(server.scheme) ? server.scheme : DEFAULT_PROXY_CONFIG.scheme,
    host,
    port: normalizeProxyPort(server.port ?? DEFAULT_PROXY_CONFIG.port)
  }
}

function parseBypassList(value: unknown): string {
  if (Array.isArray(value)) {
    const entries = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    )
    return normalizeProxyBypassRules(entries.join(','))
  }
  return normalizeProxyBypassRules(
    typeof value === 'string' ? value : DEFAULT_PROXY_CONFIG.bypassRules
  )
}

/** Convert a Chrome `ProxyConfig` into the app's persisted proxy shape. */
function fromChromeConfig(value: unknown, profileId: string): ProxyConfig {
  const input = record(value)
  const rawMode = input.mode ?? getSettings(profileId, 'proxyMode', DEFAULT_PROXY_CONFIG.mode)
  let mode: ProxyConfig['mode']
  if (rawMode === 'direct' || rawMode === 'system') {
    mode = rawMode
  } else if (rawMode === 'fixed_servers' || rawMode === 'manual') {
    mode = 'fixed_servers'
  } else if (rawMode === 'auto_detect' || rawMode === 'pac_script') {
    // PAC/WPAD is not modelled separately; fall back to Chromium's system proxy.
    mode = 'system'
  } else if (isProxyMode(rawMode)) {
    mode = rawMode
  } else {
    throw new Error('Invalid proxy mode')
  }

  if (mode === 'direct' || mode === 'system') {
    return normalizeProxyConfig({ ...DEFAULT_PROXY_CONFIG, mode })
  }

  const rules = record(input.rules)
  const server = parseProxyServer(
    rules.singleProxy ??
      rules.proxyForHttp ??
      rules.proxyForHttps ??
      rules.proxyForFtp ??
      rules.fallbackProxy
  )
  return normalizeProxyConfig({
    ...DEFAULT_PROXY_CONFIG,
    mode,
    ...(server ?? {}),
    bypassRules: parseBypassList(rules.bypassList ?? input.bypassList)
  })
}

function toChromeConfig(config: ProxyConfig): Record<string, unknown> {
  if (config.mode === 'direct' || config.mode === 'system') return { mode: config.mode }
  const bypassList = normalizeProxyBypassRules(config.bypassRules)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme: config.scheme, host: config.host, port: config.port },
      bypassList
    }
  }
}

function persistConfig(profileId: string, config: ProxyConfig): void {
  setSettings(profileId, 'proxyMode', config.mode)
  setSettings(profileId, 'proxyScheme', config.scheme)
  setSettings(profileId, 'proxyHost', config.host)
  setSettings(profileId, 'proxyPort', config.port)
  setSettings(profileId, 'proxyBypassRules', config.bypassRules)
}

function levelOfControl(profileId: string, extensionId: string): string {
  const owner = getApiSetting<string | null>(profileId, OWNER_KEY, null)
  if (!owner) return 'controllable_by_this_extension'
  return owner === extensionId ? 'controlled_by_this_extension' : 'controlled_by_other_extensions'
}

function emitProxyError(profileId: string, error: string, details: string, fatal: boolean): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: ['proxy'], event: 'onProxyError', args: [{ details, error, fatal }] },
    'proxy'
  )
}

function watchProxyErrors(contents: WebContents, profileId: string): void {
  if (watched.has(contents)) return
  watched.add(contents)
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    const label = `${errorCode} ${errorDescription}`
    if (!/proxy|tunnel/i.test(label)) return
    emitProxyError(profileId, errorDescription || String(errorCode), validatedURL, isMainFrame)
  })
}

/**
 * Forward best-effort proxy failures to extensions with the `proxy` permission.
 * Electron has no stable `onProxyError` equivalent, so both a session-level
 * hook and Chromium proxy-related load failures are observed.
 */
export function attachProxyEvents(ses: Session, profileId: string): void {
  if (trackedSessions.has(ses)) return
  trackedSessions.set(ses, profileId)

  const emitter = ses as unknown as EventEmitter
  emitter.on('proxy-error', (details: unknown) => {
    const info = record(details)
    emitProxyError(
      profileId,
      String(info.error ?? 'proxy_error'),
      String(info.details ?? ''),
      info.fatal === true
    )
  })

  for (const contents of electronWebContents.getAllWebContents()) {
    if (contents.session === ses) watchProxyErrors(contents, profileId)
  }
  if (!appListenerAttached) {
    appListenerAttached = true
    app.on('web-contents-created', (_event, contents) => {
      const owner = trackedSessions.get(contents.session)
      if (owner) watchProxyErrors(contents, owner)
    })
  }
}

export function registerProxy(): void {
  registerExtensionApiHandler('proxy', {
    permissions: ['proxy'],
    async invoke(context, method, args): Promise<unknown> {
      const ses = sessionForProfile(context.profileId)
      attachProxyEvents(ses, context.profileId)
      const options = record(args[0])

      if (method === 'get') {
        return {
          value: toChromeConfig(proxyConfigForProfile(context.profileId)),
          levelOfControl: levelOfControl(context.profileId, context.extensionId),
          ...(options.incognito === true ? { incognitoSpecific: false } : {})
        }
      }

      if (method === 'set') {
        const config = fromChromeConfig(options.value ?? args[0], context.profileId)
        persistConfig(context.profileId, config)
        setApiSetting(context.profileId, OWNER_KEY, context.extensionId)
        await applyProxyConfig(ses, config)
        return undefined
      }

      if (method === 'clear') {
        if (
          getApiSetting<string | null>(context.profileId, OWNER_KEY, null) === context.extensionId
        ) {
          deleteApiSetting(context.profileId, OWNER_KEY)
        }
        const config = normalizeProxyConfig(DEFAULT_PROXY_CONFIG)
        persistConfig(context.profileId, config)
        await applyProxyConfig(ses, config)
        return undefined
      }

      throw new Error(`chrome.proxy.${method} is not supported.`)
    }
  })
}
