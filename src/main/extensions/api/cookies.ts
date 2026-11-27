import type { Cookie, Session } from 'electron'
import { sessionForProfile } from '../../profiles/session'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

const attached = new WeakSet<Session>()

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const toCookie = (cookie: Cookie): Record<string, unknown> => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain ?? '',
  hostOnly: cookie.hostOnly ?? false,
  path: cookie.path ?? '/',
  secure: cookie.secure ?? false,
  httpOnly: cookie.httpOnly ?? false,
  session: cookie.session ?? cookie.expirationDate === undefined,
  storeId: '0',
  ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
  sameSite: cookie.sameSite
})

const matches = (cookie: Record<string, unknown>, details: Record<string, unknown>): boolean => {
  if (typeof details.name === 'string' && cookie.name !== details.name) return false
  if (typeof details.domain === 'string' && cookie.domain !== details.domain) return false
  if (typeof details.path === 'string' && cookie.path !== details.path) return false
  if (typeof details.secure === 'boolean' && cookie.secure !== details.secure) return false
  if (typeof details.session === 'boolean' && cookie.session !== details.session) return false
  if (typeof details.url === 'string' && typeof cookie.domain === 'string') {
    let host: string
    try {
      host = new URL(details.url).hostname
    } catch {
      return false
    }
    const domain = String(cookie.domain).replace(/^\./, '')
    if (host !== domain && !host.endsWith(`.${domain}`)) return false
  }
  return true
}

/** Forward Electron cookie changes to extensions with the `cookies` permission. */
export function attachCookieEvents(ses: Session, profileId: string): void {
  if (attached.has(ses)) return
  attached.add(ses)
  ses.cookies.on('changed', (_event, cookie, cause, removed) => {
    broadcastExtensionApiEvent(
      profileId,
      {
        path: ['cookies'],
        event: 'onChanged',
        args: [
          {
            cause,
            cookie: removed ? undefined : toCookie(cookie),
            removed
          }
        ]
      },
      'cookies'
    )
  })
}

export function registerCookies(): void {
  registerExtensionApiHandler('cookies', {
    permissions: ['cookies'],
    async invoke(context, method, args): Promise<unknown> {
      const cookies = sessionForProfile(context.profileId).cookies
      const details = record(args[0])

      if (method === 'get') {
        const url = typeof details.url === 'string' ? details.url : ''
        const name = typeof details.name === 'string' ? details.name : ''
        if (!url || !name) return null
        const found = await cookies.get({ url, name })
        return found[0] ? toCookie(found[0]) : null
      }
      if (method === 'getAll') {
        const all = await cookies.get({})
        return all.map(toCookie).filter((cookie) => matches(cookie, details))
      }
      if (method === 'set') {
        const url = typeof details.url === 'string' ? details.url : ''
        const name = typeof details.name === 'string' ? details.name : ''
        const value = typeof details.value === 'string' ? details.value : ''
        if (!url || !name) throw new Error('A cookie URL and name are required')
        await cookies.set({
          url,
          name,
          value,
          ...(typeof details.domain === 'string' ? { domain: details.domain } : {}),
          ...(typeof details.path === 'string' ? { path: details.path } : {}),
          ...(typeof details.secure === 'boolean' ? { secure: details.secure } : {}),
          ...(typeof details.httpOnly === 'boolean' ? { httpOnly: details.httpOnly } : {}),
          ...(typeof details.expirationDate === 'number'
            ? { expirationDate: details.expirationDate }
            : {}),
          ...(typeof details.sameSite === 'string'
            ? { sameSite: details.sameSite as Cookie['sameSite'] }
            : {})
        })
        const saved = await cookies.get({ url, name })
        return saved[0] ? toCookie(saved[0]) : null
      }
      if (method === 'remove') {
        const url = typeof details.url === 'string' ? details.url : ''
        const name = typeof details.name === 'string' ? details.name : ''
        if (!url || !name) return undefined
        await cookies.remove(url, name)
        return undefined
      }
      throw new Error(`chrome.cookies.${method} is not supported.`)
    }
  })
}
