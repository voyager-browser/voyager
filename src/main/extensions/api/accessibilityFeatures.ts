import { allWindows } from '../../window/windowRegistry'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { deleteApiSetting, getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

type AnimationPolicy = 'allowed' | 'once' | 'none'
type SettingScope = 'regular' | 'regular_only' | 'incognito_persistent' | 'incognito_session_only'

interface StoredPolicy {
  value: AnimationPolicy
  scope: SettingScope
  extensionId: string
}

const PATH = 'accessibilityFeatures.animationPolicy'
const POLICIES = new Set<AnimationPolicy>(['allowed', 'once', 'none'])
const SCOPES = new Set<SettingScope>([
  'regular',
  'regular_only',
  'incognito_persistent',
  'incognito_session_only'
])

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const storageKey = (scope: SettingScope): string => `${PATH}:${scope}`

const readScope = (profileId: string, scope: SettingScope): StoredPolicy | null =>
  getApiSetting<StoredPolicy | null>(profileId, storageKey(scope), null)

function effectiveSetting(profileId: string, incognito: boolean): StoredPolicy | null {
  const regular = readScope(profileId, 'regular')
  if (!incognito) return regular
  return (
    readScope(profileId, 'incognito_session_only') ??
    readScope(profileId, 'incognito_persistent') ??
    regular
  )
}

function settingDetails(context: ExtensionApiContext, incognito: boolean): Record<string, unknown> {
  const stored = effectiveSetting(context.profileId, incognito)
  const levelOfControl = !stored
    ? 'controllable_by_this_extension'
    : stored.extensionId === context.extensionId
      ? 'controlled_by_this_extension'
      : 'controlled_by_other_extensions'
  const details: Record<string, unknown> = {
    value: stored?.value ?? 'allowed',
    levelOfControl
  }
  if (incognito) details.incognitoSpecific = Boolean(stored?.scope.startsWith('incognito_'))
  return details
}

function emitChange(context: ExtensionApiContext, scope: SettingScope): void {
  broadcastExtensionApiEvent(
    context.profileId,
    {
      path: PATH.split('.'),
      event: 'onChange',
      args: [settingDetails(context, scope.startsWith('incognito_'))]
    },
    'accessibilityFeatures.read'
  )
}

export function registerAccessibilityFeatures(): void {
  registerExtensionApiHandler(PATH, {
    permissions: {
      get: ['accessibilityFeatures.read'],
      set: ['accessibilityFeatures.modify'],
      clear: ['accessibilityFeatures.modify']
    },
    invoke(context, method, args): unknown {
      const options = record(args[0])
      if (method === 'get') {
        return settingDetails(context, options.incognito === true)
      }
      if (method === 'set') {
        const value = options.value
        if (typeof value !== 'string' || !POLICIES.has(value as AnimationPolicy)) {
          throw new Error('Invalid animation policy value')
        }
        const scopeValue = options.scope ?? 'regular'
        if (typeof scopeValue !== 'string' || !SCOPES.has(scopeValue as SettingScope)) {
          throw new Error('Invalid animation policy scope')
        }
        const scope = scopeValue as SettingScope
        if (
          scope === 'incognito_session_only' &&
          !allWindows().some((window) => window.profile === context.profileId && window.isIncognito)
        ) {
          throw new Error('No incognito session is open')
        }
        setApiSetting(context.profileId, storageKey(scope), {
          value: value as AnimationPolicy,
          scope,
          extensionId: context.extensionId
        } satisfies StoredPolicy)
        emitChange(context, scope)
        return undefined
      }
      if (method === 'clear') {
        const scopeValue = options.scope ?? 'regular'
        if (typeof scopeValue !== 'string' || !SCOPES.has(scopeValue as SettingScope)) {
          throw new Error('Invalid animation policy scope')
        }
        const scope = scopeValue as SettingScope
        const stored = readScope(context.profileId, scope)
        if (stored?.extensionId === context.extensionId) {
          deleteApiSetting(context.profileId, storageKey(scope))
        }
        emitChange(context, scope)
        return undefined
      }
      throw new Error(`chrome.accessibilityFeatures.animationPolicy.${method} is not supported.`)
    }
  })
}
