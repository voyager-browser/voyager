import { app } from 'electron'
import { registerExtensionApiHandler } from './registry'
import { expandMessage, extensionMessages, safeLocale, type MessageEntry } from '../manifestI18n'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export function registerI18n(): void {
  registerExtensionApiHandler('i18n', {
    invoke(context, method, args): unknown {
      if (method === 'getMessage') {
        const name = typeof args[0] === 'string' ? args[0] : ''
        const substitutions = Array.isArray(args[1]) ? args[1] : []
        const manifest = record(context.manifest)
        const entry = record(
          extensionMessages(manifest, context.extension.path)[name]
        ) as MessageEntry
        return expandMessage(entry, substitutions)
      }
      if (method === 'getLanguage') {
        return safeLocale(record(context.manifest).default_locale, 'en')
      }
      if (method === 'getUILanguage') {
        return app.getLocale()
      }
      if (method === 'getAcceptLanguages') {
        const language = safeLocale(record(context.manifest).default_locale, 'en')
        const uiLanguage = app.getLocale()
        return [...new Set([uiLanguage, uiLanguage.split('-')[0] ?? uiLanguage, language, 'en'])]
      }
      throw new Error(`chrome.i18n.${method} is not supported.`)
    }
  })
}
