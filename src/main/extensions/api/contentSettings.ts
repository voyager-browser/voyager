import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

const PATH = 'contentSettings'

const CONTENT_TYPES = [
  'cookies',
  'images',
  'javascript',
  'plugins',
  'popups',
  'notifications',
  'geolocation',
  'microphone',
  'camera'
] as const

type ContentType = (typeof CONTENT_TYPES)[number]

interface StoredSetting {
  settingId: ContentType
  value: string
  primaryPattern: string
  secondaryPattern: string
  resourceIdentifier?: string
  scope?: string
}

type SettingStore = Record<string, Record<string, StoredSetting>>

const DEFAULT_VALUE = 'allow'
const VALID_VALUES = new Set(['allow', 'block', 'ask', 'session_only'])
const ALL_PATTERN = '<all_urls>'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value)
}

const storageKey = (extensionId: string): string => `${PATH}:${extensionId}`

function readStore(profileId: string, extensionId: string): SettingStore {
  const stored = getApiSetting<SettingStore>(profileId, storageKey(extensionId), {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: SettingStore = {}
  for (const [type, rules] of Object.entries(stored)) {
    if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
      result[type] = { ...(rules as Record<string, StoredSetting>) }
    }
  }
  return result
}

function saveStore(profileId: string, extensionId: string, store: SettingStore): void {
  setApiSetting(profileId, storageKey(extensionId), store)
}

/**
 * The bridge registers one dotted path, so callers pass the content type as
 * the first argument or as `settingId` on the details object.
 */
function settingContext(
  args: unknown[],
  fixedType: ContentType | null = null
): { contentType: ContentType; details: Record<string, unknown> } {
  if (fixedType) return { contentType: fixedType, details: record(args[0]) }
  const first = args[0]
  if (typeof first === 'string' && isContentType(first.toLowerCase())) {
    return {
      contentType: first.toLowerCase() as ContentType,
      details: record(args[1])
    }
  }
  const details = record(first)
  const candidate = details.settingId ?? details.contentType ?? details.type
  if (isContentType(candidate)) {
    return { contentType: candidate, details }
  }
  throw new Error('A supported content setting type is required')
}

function optionalContentType(args: unknown[]): ContentType | null {
  const first = args[0]
  if (typeof first === 'string' && isContentType(first.toLowerCase())) {
    return first.toLowerCase() as ContentType
  }
  const details = record(first)
  const candidate = details.settingId ?? details.contentType ?? details.type
  return isContentType(candidate) ? candidate : null
}

const primaryPattern = (details: Record<string, unknown>): string => {
  const value = details.primaryPattern ?? details.primaryUrl
  return typeof value === 'string' && value.length > 0 ? value : ALL_PATTERN
}

const secondaryPattern = (details: Record<string, unknown>): string => {
  const value = details.secondaryPattern ?? details.secondaryUrl
  return typeof value === 'string' && value.length > 0 ? value : ALL_PATTERN
}

function resourceIdentifier(details: Record<string, unknown>): string | undefined {
  const raw = details.resourceIdentifier
  if (typeof raw === 'string') return raw.length > 0 ? raw : undefined
  const parsed = record(raw)
  return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : undefined
}

function scopeFor(details: Record<string, unknown>, fallback = 'regular'): string {
  const scope = details.scope
  if (scope === 'regular' || scope === 'incognito_session_only') return scope
  if (details.incognito === true) return 'incognito_session_only'
  return fallback
}

function ruleKey(
  setting: Pick<StoredSetting, 'scope' | 'primaryPattern' | 'secondaryPattern'> & {
    resourceIdentifier?: string
  }
): string {
  return JSON.stringify([
    setting.scope ?? 'regular',
    setting.primaryPattern,
    setting.secondaryPattern,
    setting.resourceIdentifier ?? ''
  ])
}

function publicSetting(setting: StoredSetting): Record<string, unknown> {
  return {
    settingId: setting.settingId,
    value: setting.value,
    primaryPattern: setting.primaryPattern,
    secondaryPattern: setting.secondaryPattern,
    ...(setting.resourceIdentifier ? { resourceIdentifier: setting.resourceIdentifier } : {}),
    ...(setting.scope && setting.scope !== 'regular' ? { scope: setting.scope } : {})
  }
}

function normalizeValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'allow' : 'block'
  if (typeof value === 'number') {
    if (value === 0) return 'block'
    if (value === 1) return 'allow'
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (VALID_VALUES.has(normalized)) return normalized
  }
  throw new Error('Invalid content setting value')
}

function emit(profileId: string, setting: StoredSetting): void {
  for (const path of [[PATH], [PATH, setting.settingId]]) {
    broadcastExtensionApiEvent(
      profileId,
      { path, event: 'onSettingChanged', args: [publicSetting(setting)] },
      PATH
    )
  }
}

function invokeContentSettings(
  context: ExtensionApiContext,
  fixedType: ContentType | null,
  method: string,
  args: unknown[]
): unknown {
  const profileId = context.profileId
  const requested = fixedType ?? optionalContentType(args)
  const store = readStore(profileId, context.extensionId)

  if (method === 'getAll') {
    return Object.values(store)
      .flatMap((rules) => Object.values(rules))
      .filter((setting) => !requested || setting.settingId === requested)
      .map(publicSetting)
  }

  if (method === 'getResourceIdentifiers') {
    if (requested !== 'plugins') return []
    const seen = new Set<string>()
    const identifiers: Array<{ id: string; description: string }> = []
    for (const setting of Object.values(store.plugins ?? {})) {
      const id = setting.resourceIdentifier
      if (!id || seen.has(id)) continue
      seen.add(id)
      identifiers.push({ id, description: id })
    }
    return identifiers
  }

  const parsed = settingContext(args, fixedType)
  const contentType = parsed.contentType
  const details = parsed.details
  const primary = primaryPattern(details)
  const secondary = secondaryPattern(details)
  const resource = resourceIdentifier(details)
  const scope = scopeFor(details)
  const rules = store[contentType] ?? {}

  if (method === 'get') {
    const key = ruleKey({
      scope,
      primaryPattern: primary,
      secondaryPattern: secondary,
      resourceIdentifier: resource
    })
    const found =
      rules[key] ??
      (scope === 'incognito_session_only'
        ? rules[
            ruleKey({
              scope: 'regular',
              primaryPattern: primary,
              secondaryPattern: secondary,
              resourceIdentifier: resource
            })
          ]
        : undefined)
    return publicSetting(
      found ?? {
        settingId: contentType,
        value: DEFAULT_VALUE,
        primaryPattern: primary,
        secondaryPattern: secondary,
        ...(resource ? { resourceIdentifier: resource } : {}),
        scope
      }
    )
  }

  if (method === 'set') {
    const valueSource =
      details.setting ?? details.value ?? (typeof args[0] === 'string' ? args[2] : args[1])
    const value = normalizeValue(valueSource)
    const setting: StoredSetting = {
      settingId: contentType,
      value,
      primaryPattern: primary,
      secondaryPattern: secondary,
      ...(resource ? { resourceIdentifier: resource } : {}),
      scope
    }
    store[contentType] = { ...rules, [ruleKey(setting)]: setting }
    saveStore(profileId, context.extensionId, store)
    emit(profileId, setting)
    return undefined
  }

  if (method === 'clear') {
    const hasPattern =
      details.primaryPattern !== undefined ||
      details.primaryUrl !== undefined ||
      details.secondaryPattern !== undefined ||
      details.secondaryUrl !== undefined
    let kept = rules
    if (hasPattern || resource) {
      const key = ruleKey({
        scope,
        primaryPattern: primary,
        secondaryPattern: secondary,
        resourceIdentifier: resource
      })
      if (rules[key]) {
        kept = { ...rules }
        delete kept[key]
      }
    } else {
      kept = Object.fromEntries(
        Object.entries(rules).filter(([, setting]) => (setting.scope ?? 'regular') !== scope)
      )
    }
    for (const setting of Object.values(rules)) {
      if (kept[ruleKey(setting)] === undefined) {
        emit(profileId, { ...setting, value: DEFAULT_VALUE })
      }
    }
    if (Object.keys(kept).length === 0) delete store[contentType]
    else store[contentType] = kept
    saveStore(profileId, context.extensionId, store)
    return undefined
  }

  throw new Error(`chrome.${PATH}.${method} is not supported.`)
}

/** One handler per content type matches Chrome's `contentSettings.<type>` surface. */
export function registerContentSettings(): void {
  for (const type of CONTENT_TYPES) {
    registerExtensionApiHandler(`${PATH}.${type}`, {
      permissions: [PATH],
      invoke(context, method, args) {
        return invokeContentSettings(context, type, method, args)
      }
    })
  }
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(context, method, args) {
      return invokeContentSettings(context, null, method, args)
    }
  })
}
