/**
 * Per-extension site access, mirroring Chrome's "When you click / On this site
 * / On all sites" menu. Stored separately from pinned state so both the menu
 * and the main-process event bridges can enforce the same rule.
 */

import type { ExtensionSiteAccess } from '../../shared/types'
import { getSettings, setSettings } from '../store'

const SITE_ACCESS_KEY = 'extensionSiteAccess'

export interface ExtensionSiteAccessRule {
  access: ExtensionSiteAccess
  /** Site keys allowed when `access` is `site`. */
  sites: string[]
}

type StoredRule = ExtensionSiteAccess | ExtensionSiteAccessRule

/** Stable key for a site, used for both storage and event filtering. */
export function siteKeyForUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') return 'file://'
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname || null
    return null
  } catch {
    // Context menus store a bare hostname; accept it without treating an
    // arbitrary string as a valid site key.
    return /^[a-z0-9.-]+$/i.test(value) ? value.toLowerCase() : null
  }
}

export function siteAccessRules(profileId: string): Record<string, ExtensionSiteAccessRule> {
  const stored = getSettings<Record<string, StoredRule>>(profileId, SITE_ACCESS_KEY, {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: Record<string, ExtensionSiteAccessRule> = {}
  for (const [id, value] of Object.entries(stored)) {
    if (value === 'click' || value === 'site' || value === 'all') {
      result[id] = { access: value, sites: [] }
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const rule = value as Partial<ExtensionSiteAccessRule>
    if (rule.access !== 'click' && rule.access !== 'site' && rule.access !== 'all') continue
    result[id] = {
      access: rule.access,
      sites: Array.isArray(rule.sites)
        ? [
            ...new Set(
              rule.sites
                .filter((site): site is string => typeof site === 'string')
                .map((site) => siteKeyForUrl(site))
                .filter((site): site is string => site !== null)
            )
          ]
        : []
    }
  }
  return result
}

/**
 * Persist a choice. A `site` choice remembers the selected site; older callers
 * that omit it keep the previously stored site.
 */
export function setExtensionSiteAccess(
  profileId: string,
  id: string,
  access: ExtensionSiteAccess,
  site?: string | null
): ExtensionSiteAccessRule {
  const rules = siteAccessRules(profileId)
  const previous = rules[id] ?? { access: 'click' as const, sites: [] }
  const siteKey = typeof site === 'string' ? siteKeyForUrl(site) : null
  const sites =
    access === 'site' && siteKey !== null
      ? [...new Set([...previous.sites, siteKey])]
      : previous.sites
  const rule = { access, sites }
  setSettings(profileId, SITE_ACCESS_KEY, { ...rules, [id]: rule })
  return rule
}

/** Whether the extension may receive page data for `url`. */
export function extensionCanAccessSite(
  profileId: string,
  extensionId: string,
  url: string
): boolean {
  const rule = siteAccessRules(profileId)[extensionId]
  if (!rule || rule.access === 'click') return false
  if (rule.access === 'all') return true
  const site = siteKeyForUrl(url)
  return site !== null && rule.sites.includes(site)
}
