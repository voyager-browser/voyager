import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface MessageEntry {
  message?: string
  placeholders?: Record<string, { content?: string }>
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const safeLocale = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const locale = value.trim()
  return /^[A-Za-z0-9_-]+$/.test(locale) ? locale : fallback
}

/**
 * Load the same locale messages Chromium exposes through `chrome.i18n`, with
 * the app UI language taking precedence over the manifest's default locale.
 */
export function extensionMessages(
  manifest: Record<string, unknown>,
  extensionPath: string | null | undefined
): Record<string, MessageEntry> {
  const defaultLocale = safeLocale(manifest.default_locale, 'en')
  const uiLocale = app.getLocale()
  const candidates = [uiLocale, uiLocale.split('-')[0] ?? uiLocale, defaultLocale, 'en']
  const root = join(extensionPath ?? '', '_locales')
  for (const candidate of candidates) {
    const file = join(root, safeLocale(candidate, defaultLocale), 'messages.json')
    if (!existsSync(file)) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      return record(parsed) as Record<string, MessageEntry>
    } catch {
      // A malformed locale file falls back to the next candidate.
    }
  }
  return {}
}

export function expandMessage(entry: MessageEntry, substitutions: unknown[]): string {
  let message = typeof entry.message === 'string' ? entry.message : ''
  const placeholders = entry.placeholders ?? {}
  for (const [name, placeholder] of Object.entries(placeholders)) {
    const content = typeof placeholder.content === 'string' ? placeholder.content : ''
    const value = substitutions[Number(content.replace(/^\$/, '')) - 1]
    if (value === undefined) continue
    message = message.split(`$${name}$`).join(String(value))
    if (content) message = message.split(content).join(String(value))
  }
  for (let index = 1; index <= 9; index += 1) {
    const value = substitutions[index - 1]
    if (value === undefined) continue
    message = message.split(`$${index}`).join(String(value))
  }
  return message
}

/** Resolve a manifest's `__MSG_name__` string before the extension is loaded. */
export function localizedManifestString(
  value: unknown,
  manifest: Record<string, unknown>,
  extensionPath: string | null | undefined
): string {
  if (typeof value !== 'string') return ''
  const messageName = /^__MSG_([A-Za-z0-9_@]+)__$/.exec(value)?.[1]
  if (!messageName) return value
  const entry = record(extensionMessages(manifest, extensionPath)[messageName]) as MessageEntry
  return expandMessage(entry, [])
}
