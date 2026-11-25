import { app, type BeforeSendResponse, type HeadersReceivedResponse, type Session } from 'electron'
import { listProfiles } from '../../profiles/profiles'
import { sessionForProfile } from '../../profiles/session'
import { broadcastExtensionApiEvent } from './events'
import { hasApiPermission } from './permissions'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, listApiSettingKeys, setApiSetting } from './storage'

const RULES_KEY_PREFIX = 'declarativeNetRequest:rules:'
const REQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'] }
const MAX_MATCH_RECORDS = 500
const DNR_PERMISSIONS = ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess'] as const

type ActionType = 'block' | 'allow' | 'redirect' | 'modifyHeaders'
type HeaderOperationKind = 'set' | 'remove' | 'append'

interface HeaderOperation {
  header: string
  operation: HeaderOperationKind
  value?: string
}

interface RuleCondition {
  urlFilter?: string
  regexFilter?: string
  resourceTypes?: string[]
  excludedResourceTypes?: string[]
  requestDomains?: string[]
  excludedRequestDomains?: string[]
  initiatorDomains?: string[]
  excludedInitiatorDomains?: string[]
}

interface DnrRule {
  id: number
  priority: number
  action: {
    type: ActionType
    redirectUrl?: string
    requestHeaders: HeaderOperation[]
    responseHeaders: HeaderOperation[]
  }
  condition: RuleCondition
}

interface RuleStore {
  dynamic: DnrRule[]
  session: DnrRule[]
  disabledStaticRulesets: string[]
}

interface RequestInfo {
  id: number
  url: string
  method: string
  resourceType: string
  webContentsId?: number
  initiatorOrigin?: string
  timestamp: number
}

interface MatchedRuleRef {
  extensionId: string
  rule: DnrRule
}

interface MatchRecord {
  ruleId: number
  extensionId: string
  tabId: number
  url: string
  timeStamp: number
}

const attached = new WeakSet<Session>()
const matchesByProfile = new Map<string, MatchRecord[]>()
const regexCache = new Map<string, RegExp | null>()
let appListenerAttached = false

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const rulesKey = (extensionId: string): string => `${RULES_KEY_PREFIX}${extensionId}`

function normalizeHeaderOperations(value: unknown): HeaderOperation[] {
  if (!Array.isArray(value)) return []
  const operations: HeaderOperation[] = []
  for (const item of value) {
    const input = record(item)
    const header = typeof input.header === 'string' ? input.header.trim().toLowerCase() : ''
    const kind = input.operation
    const operation: HeaderOperationKind | null =
      kind === 'set' || kind === 'remove' || kind === 'append' ? kind : null
    if (!header || !operation) continue
    operations.push({
      header,
      operation,
      ...(typeof input.value === 'string' ? { value: input.value } : {})
    })
  }
  return operations
}

function normalizeRule(value: unknown): DnrRule | null {
  const input = record(value)
  if (typeof input.id !== 'number' || !Number.isFinite(input.id)) return null
  const action = record(input.action)
  const type = action.type
  if (type !== 'block' && type !== 'allow' && type !== 'redirect' && type !== 'modifyHeaders') {
    return null
  }

  const rawCondition = record(input.condition)
  const condition: RuleCondition = {}
  if (typeof rawCondition.urlFilter === 'string') condition.urlFilter = rawCondition.urlFilter
  if (typeof rawCondition.regexFilter === 'string') condition.regexFilter = rawCondition.regexFilter
  for (const key of [
    'resourceTypes',
    'excludedResourceTypes',
    'requestDomains',
    'excludedRequestDomains',
    'initiatorDomains',
    'excludedInitiatorDomains'
  ] as const) {
    const values = strings(rawCondition[key])
    if (values.length > 0) condition[key] = values
  }

  return {
    id: Math.trunc(input.id),
    priority:
      typeof input.priority === 'number' && Number.isFinite(input.priority) ? input.priority : 0,
    action: {
      type,
      ...(type === 'redirect' && typeof action.redirectUrl === 'string'
        ? { redirectUrl: action.redirectUrl }
        : {}),
      requestHeaders: normalizeHeaderOperations(action.requestHeaders),
      responseHeaders: normalizeHeaderOperations(action.responseHeaders)
    },
    condition
  }
}

function readStore(profileId: string, extensionId: string): RuleStore {
  const stored = record(getApiSetting<unknown>(profileId, rulesKey(extensionId), {}))
  const rules = (value: unknown): DnrRule[] =>
    Array.isArray(value)
      ? value.map(normalizeRule).filter((rule): rule is DnrRule => rule !== null)
      : []
  return {
    dynamic: rules(stored.dynamic),
    session: rules(stored.session),
    disabledStaticRulesets: strings(stored.disabledStaticRulesets)
  }
}

function writeStore(profileId: string, extensionId: string, store: RuleStore): void {
  setApiSetting(profileId, rulesKey(extensionId), store)
}

function staticRulesets(
  manifest: Record<string, unknown>
): Array<{ id: string; enabled: boolean }> {
  const declarative = record(manifest.declarative_net_request)
  const resources = Array.isArray(declarative.rule_resources) ? declarative.rule_resources : []
  const result: Array<{ id: string; enabled: boolean }> = []
  for (const item of resources) {
    const resource = record(item)
    if (typeof resource.id !== 'string' || resource.id.length === 0) continue
    result.push({ id: resource.id, enabled: resource.enabled !== false })
  }
  return result
}

function hasDnrPermission(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>
): boolean {
  return DNR_PERMISSIONS.some((permission) =>
    hasApiPermission(profileId, extensionId, manifest, permission)
  )
}

function extensionAllowed(ses: Session, profileId: string, extensionId: string): boolean {
  const extension = ses.extensions.getAllExtensions().find((item) => item.id === extensionId)
  if (!extension) return false
  const manifest = (extension.manifest ?? {}) as Record<string, unknown>
  return hasDnrPermission(profileId, extensionId, manifest)
}

const CHROME_RESOURCE_TYPES: Record<string, string> = {
  main_frame: 'mainFrame',
  sub_frame: 'subFrame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xmlhttprequest: 'xhr',
  ping: 'ping',
  csp_report: 'cspReport',
  media: 'media',
  websocket: 'webSocket',
  other: 'other'
}

function electronResourceType(value: string): string {
  return CHROME_RESOURCE_TYPES[value] ?? value
}

function hostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '') || null
  } catch {
    return null
  }
}

function globMatch(pattern: string, value: string): boolean {
  let p = 0
  let v = 0
  let star = -1
  let resume = 0
  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) {
      p += 1
      v += 1
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p
      resume = v
      p += 1
    } else if (star >= 0) {
      p = star + 1
      resume += 1
      v = resume
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1
  return p === pattern.length
}

function urlFilterMatches(filter: string, url: string): boolean {
  const trimmed = filter.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('||')) {
    const rest = trimmed.slice(2)
    const separator = rest.search(/[\^*?]/)
    const domain = (separator === -1 ? rest : rest.slice(0, separator)).toLowerCase()
    const host = hostname(url)
    if (!host || !(host === domain || host.endsWith(`.${domain}`))) return false
    if (separator === -1) return true
    const tail = rest.slice(separator).replace(/\^/g, '*').replace(/\|$/, '')
    return globMatch(`*${tail}`, url)
  }
  const pattern = trimmed.replace(/^\|/, '').replace(/\|$/, '').replace(/\^/g, '*')
  return globMatch(pattern, url)
}

function domainListMatches(domains: string[], host: string): boolean {
  return domains.some((entry) => {
    const domain = entry.toLowerCase().replace(/^\./, '')
    return host === domain || host.endsWith(`.${domain}`)
  })
}

function regexFor(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern) ?? null
  let compiled: RegExp | null = null
  try {
    // Chrome uses RE2: backreferences and lookaround are not supported.
    if (pattern.length <= 512 && !/\\[1-9]/.test(pattern) && !/\(\?<?[=!]/.test(pattern)) {
      compiled = new RegExp(pattern, 'i')
    }
  } catch {
    compiled = null
  }
  regexCache.set(pattern, compiled)
  return compiled
}

function regexSupport(pattern: string): { isSupported: boolean; reason?: string } {
  if (pattern.length > 512) return { isSupported: false, reason: 'regexTooLarge' }
  if (/\\[1-9]/.test(pattern) || /\(\?<?[=!]/.test(pattern)) {
    return { isSupported: false, reason: 'syntaxUnsupported' }
  }
  return regexFor(pattern)
    ? { isSupported: true }
    : { isSupported: false, reason: 'syntaxUnsupported' }
}

function matchesRule(rule: DnrRule, info: RequestInfo): boolean {
  const condition = rule.condition
  if (condition.urlFilter && !urlFilterMatches(condition.urlFilter, info.url)) return false
  if (condition.regexFilter) {
    const regex = regexFor(condition.regexFilter)
    if (!regex || !regex.test(info.url)) return false
  }

  if (condition.resourceTypes?.length) {
    const allowed = condition.resourceTypes.map(electronResourceType)
    if (!allowed.includes(info.resourceType)) return false
  }
  if (condition.excludedResourceTypes?.length) {
    const excluded = condition.excludedResourceTypes.map(electronResourceType)
    if (excluded.includes(info.resourceType)) return false
  }

  const requestHost = hostname(info.url)
  if (condition.requestDomains?.length) {
    if (!requestHost || !domainListMatches(condition.requestDomains, requestHost)) return false
  }
  if (condition.excludedRequestDomains?.length && requestHost) {
    if (domainListMatches(condition.excludedRequestDomains, requestHost)) return false
  }

  const initiatorHost = info.initiatorOrigin ? hostname(info.initiatorOrigin) : null
  if (condition.initiatorDomains?.length) {
    if (!initiatorHost || !domainListMatches(condition.initiatorDomains, initiatorHost)) {
      return false
    }
  }
  if (condition.excludedInitiatorDomains?.length && initiatorHost) {
    if (domainListMatches(condition.excludedInitiatorDomains, initiatorHost)) return false
  }
  return true
}

function matchedRules(ses: Session, profileId: string, info: RequestInfo): MatchedRuleRef[] {
  const matches: MatchedRuleRef[] = []
  for (const key of listApiSettingKeys(profileId, RULES_KEY_PREFIX)) {
    const extensionId = key.slice(RULES_KEY_PREFIX.length)
    if (!extensionAllowed(ses, profileId, extensionId)) continue
    const store = readStore(profileId, extensionId)
    for (const rule of [...store.dynamic, ...store.session]) {
      if (matchesRule(rule, info)) matches.push({ extensionId, rule })
    }
  }
  return matches
}

function selectRule(matches: MatchedRuleRef[]): MatchedRuleRef | null {
  const sorted = [...matches].sort(
    (a, b) => b.rule.priority - a.rule.priority || b.rule.id - a.rule.id
  )
  return sorted[0] ?? null
}

function safeRedirectUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function recordMatches(profileId: string, matches: MatchedRuleRef[], info: RequestInfo): void {
  if (matches.length === 0) return
  const records = matchesByProfile.get(profileId) ?? []
  const timeStamp = Date.now()
  for (const { extensionId, rule } of matches) {
    records.unshift({
      ruleId: rule.id,
      extensionId,
      tabId: info.webContentsId ?? -1,
      url: info.url,
      timeStamp
    })
    broadcastExtensionApiEvent(
      profileId,
      {
        path: ['declarativeNetRequest'],
        event: 'onRuleMatchedDebug',
        args: [{ ruleId: rule.id, tabId: info.webContentsId ?? -1, timeStamp }],
        extensionId
      },
      'declarativeNetRequest'
    )
  }
  matchesByProfile.set(profileId, records.slice(0, MAX_MATCH_RECORDS))
}

function requestInfo(
  details: { id: number; url: string; method: string; resourceType: string } & {
    webContentsId?: number
    initiatorOrigin?: string
    timestamp: number
  }
): RequestInfo {
  return {
    id: details.id,
    url: details.url,
    method: details.method,
    resourceType: details.resourceType,
    ...(details.webContentsId === undefined ? {} : { webContentsId: details.webContentsId }),
    ...(details.initiatorOrigin === undefined ? {} : { initiatorOrigin: details.initiatorOrigin }),
    timestamp: details.timestamp
  }
}

function applyHeaderOperations(
  headers: Record<string, string | string[]>,
  operations: HeaderOperation[]
): void {
  const names = new Map(Object.keys(headers).map((key) => [key.toLowerCase(), key]))
  for (const operation of operations) {
    const lower = operation.header.toLowerCase()
    const key = names.get(lower) ?? operation.header
    const value = operation.value ?? ''
    if (operation.operation === 'remove') {
      delete headers[key]
      names.delete(lower)
    } else if (operation.operation === 'set') {
      headers[key] = value
      names.set(lower, key)
    } else {
      const existing = headers[key]
      if (Array.isArray(existing)) headers[key] = [...existing, value]
      else if (typeof existing === 'string') headers[key] = [existing, value]
      else headers[key] = [value]
      names.set(lower, key)
    }
  }
}

function headerOperations(
  matches: MatchedRuleRef[],
  kind: 'requestHeaders' | 'responseHeaders'
): HeaderOperation[] {
  const operations: HeaderOperation[] = []
  for (const { rule } of matches) {
    if (rule.action.type !== 'modifyHeaders') continue
    operations.push(...rule.action[kind])
  }
  return operations
}

function watchNewContents(): void {
  if (appListenerAttached) return
  appListenerAttached = true
  app.on('web-contents-created', (_event, contents) => {
    for (const profile of listProfiles()) {
      const ses = sessionForProfile(profile.id)
      if (contents.session !== ses) continue
      attachDeclarativeNetRequest(ses, profile.id)
      return
    }
  })
}

/**
 * Apply persisted DNR rules through the same session.webRequest hook used by
 * content blocking. Rules are evaluated per request from the profile settings
 * bucket, so updates take effect without restarting the session.
 */
export function attachDeclarativeNetRequest(ses: Session, profileId: string): void {
  if (attached.has(ses)) return
  attached.add(ses)

  ses.webRequest.onBeforeRequest(REQUEST_FILTER, (details, callback) => {
    const info = requestInfo(details)
    const matches = matchedRules(ses, profileId, info)
    recordMatches(profileId, matches, info)
    const selected = selectRule(matches)
    const action = selected?.rule.action
    if (action?.type === 'block') {
      callback({ cancel: true })
      return
    }
    const redirect = action?.type === 'redirect' ? safeRedirectUrl(action.redirectUrl) : null
    callback(redirect ? { redirectURL: redirect } : { cancel: false })
  })

  ses.webRequest.onBeforeSendHeaders(
    REQUEST_FILTER,
    (details, callback: (response: BeforeSendResponse) => void) => {
      const info = requestInfo(details)
      const headers: Record<string, string | string[]> = { ...details.requestHeaders }
      applyHeaderOperations(
        headers,
        headerOperations(matchedRules(ses, profileId, info), 'requestHeaders')
      )
      callback(Object.keys(headers).length > 0 ? { requestHeaders: headers } : {})
    }
  )

  ses.webRequest.onHeadersReceived(
    REQUEST_FILTER,
    (details, callback: (response: HeadersReceivedResponse) => void) => {
      const info = requestInfo(details)
      const headers: Record<string, string | string[]> = { ...(details.responseHeaders ?? {}) }
      applyHeaderOperations(
        headers,
        headerOperations(matchedRules(ses, profileId, info), 'responseHeaders')
      )
      callback({ responseHeaders: headers, statusLine: details.statusLine })
    }
  )

  watchNewContents()
}

function cloneRule(rule: DnrRule): DnrRule {
  const normalized = normalizeRule(rule)
  return normalized ?? rule
}

export function registerDeclarativeNetRequest(): void {
  registerExtensionApiHandler('declarativeNetRequest', {
    // Both DNR permissions are alternative grants; the registry requires every
    // listed permission, so the either/or check happens inside the handler.
    invoke(context, method, args): unknown {
      if (!hasDnrPermission(context.profileId, context.extensionId, context.manifest)) {
        throw new Error('Missing extension permission: declarativeNetRequest')
      }
      const ses = sessionForProfile(context.profileId)
      attachDeclarativeNetRequest(ses, context.profileId)
      const options = record(args[0])
      const store = readStore(context.profileId, context.extensionId)

      if (method === 'updateDynamicRules' || method === 'updateSessionRules') {
        const field = method === 'updateDynamicRules' ? 'dynamic' : 'session'
        const removeIds = new Set(
          Array.isArray(options.removeRuleIds)
            ? options.removeRuleIds.filter(
                (id): id is number => typeof id === 'number' && Number.isFinite(id)
              )
            : []
        )
        const additions = Array.isArray(options.addRules)
          ? options.addRules.map(normalizeRule).filter((rule): rule is DnrRule => rule !== null)
          : []
        const current = store[field].filter((rule) => !removeIds.has(rule.id))
        const ids = new Set(current.map((rule) => rule.id))
        for (const rule of additions) {
          if (ids.has(rule.id))
            throw new Error(`Duplicate declarativeNetRequest rule id ${rule.id}`)
          ids.add(rule.id)
        }
        store[field] = [...current, ...additions]
        writeStore(context.profileId, context.extensionId, store)
        return undefined
      }

      if (method === 'getDynamicRules' || method === 'getSessionRules') {
        const rules = method === 'getDynamicRules' ? store.dynamic : store.session
        return rules.map(cloneRule)
      }

      if (method === 'getEnabledRulesets') {
        const disabled = new Set(store.disabledStaticRulesets)
        return staticRulesets(context.manifest)
          .filter((ruleset) => ruleset.enabled && !disabled.has(ruleset.id))
          .map((ruleset) => ruleset.id)
      }

      if (method === 'getAvailableStaticRulesets') {
        return staticRulesets(context.manifest).map((ruleset) => ruleset.id)
      }

      if (method === 'updateStaticRules') {
        const disabled = new Set(store.disabledStaticRulesets)
        for (const id of strings(options.disableRulesetIds)) disabled.add(id)
        for (const id of strings(options.enableRulesetIds)) disabled.delete(id)
        store.disabledStaticRulesets = [...disabled]
        writeStore(context.profileId, context.extensionId, store)
        return undefined
      }

      if (method === 'getMatchedRules') {
        const minTimeStamp = typeof options.minTimeStamp === 'number' ? options.minTimeStamp : 0
        const tabId = typeof options.tabId === 'number' ? options.tabId : null
        const matches = (matchesByProfile.get(context.profileId) ?? []).filter(
          (entry) =>
            entry.extensionId === context.extensionId &&
            entry.timeStamp >= minTimeStamp &&
            (tabId === null || entry.tabId === tabId)
        )
        return {
          rulesMatchedInfo: matches.map((entry) => ({
            ruleId: entry.ruleId,
            tabId: entry.tabId,
            timeStamp: entry.timeStamp,
            url: entry.url
          }))
        }
      }

      if (method === 'isRegexSupported') {
        const pattern = typeof options.regex === 'string' ? options.regex : ''
        return regexSupport(pattern)
      }

      if (method === 'getRuleConfiguration') {
        const requested = new Set(
          Array.isArray(options.ids)
            ? options.ids.filter(
                (id): id is number => typeof id === 'number' && Number.isFinite(id)
              )
            : []
        )
        return [...store.dynamic, ...store.session]
          .filter((rule) => requested.size === 0 || requested.has(rule.id))
          .map((rule) => ({
            id: rule.id,
            priority: rule.priority,
            condition: { ...rule.condition },
            action: cloneRule(rule).action
          }))
      }

      throw new Error(`chrome.declarativeNetRequest.${method} is not supported.`)
    }
  })
}

registerDeclarativeNetRequest()
