import type { Session } from 'electron'
import { getSettings } from '../store'

const defaultUserAgents = new WeakMap<Session, string>()

export function userAgentForProfile(profileId: string): string {
  const value = getSettings(profileId, 'userAgent', '')
  return typeof value === 'string' ? value : ''
}

export function applyUserAgentForProfile(ses: Session, profileId: string): void {
  if (!defaultUserAgents.has(ses)) {
    defaultUserAgents.set(ses, ses.getUserAgent())
  }
  const custom = userAgentForProfile(profileId).trim()
  const fallback = defaultUserAgents.get(ses) ?? ses.getUserAgent()
  ses.setUserAgent(custom || fallback)
}
