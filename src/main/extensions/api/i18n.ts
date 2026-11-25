import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { registerExtensionApiHandler } from './registry'
import type { ExtensionApiContext } from './types'

interface MessageEntry {
  message?: string
  placeholders?: Record<string, { content?: string }>
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const safeLocale = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const locale = value.trim()
  return /^[A-Za-z0-9_-]+$/.test(locale) ? locale : fallback
}

function readMessages(context: ExtensionApiContext): Record<string, MessageEntry> {
  const defaultLocale = safeLocale(context.manifest.default_locale, 'en')
  const uiLocale = app.getLocale()
  const candidates = [uiLocale, uiLocale.split('-')[0] ?? uiLocale, defaultLocale]
  const root = join(context.extension.path ?? '', '_locales')
  for (const candidate of candidates) {
    const file = join(root, safeLocale(candidate, defaultLocale), 'messages.json')
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, MessageEntry>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      // A malformed locale file falls back to the next candidate.
    }
  }
  return {}
}

function expandMessage(entry: MessageEntry, substitutions: unknown[]): string {
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
    if (value !== undefined) message = message.split(`$${index}`).join(String(value))
  }
  return message
}

export function registerI18n(): void {
  registerExtensionApiHandler('i18n', {
    invoke(context, method, args): unknown {
      if (method === 'getMessage') {
        const name = typeof args[0] === 'string' ? args[0] : ''
        const substitutions = Array.isArray(args[1]) ? args[1] : []
        const entry = record(readMessages(context)[name]) as MessageEntry
        return expandMessage(entry, substitutions)
      }
      if (method === 'getLanguage') {
        return safeLocale(context.manifest.default_locale, 'en')
      }
      if (method === 'getUILanguage') {
        return app.getLocale()
      }
      if (method === 'getAcceptLanguages') {
        const language = safeLocale(context.manifest.default_locale, 'en')
        const uiLanguage = app.getLocale()
        return [...new Set([uiLanguage, uiLanguage.split('-')[0] ?? uiLanguage, language, 'en'])]
      }
      throw new Error(`chrome.i18n.${method} is not supported.`)
    }
  })
}
