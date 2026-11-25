import { randomUUID } from 'node:crypto'
import { webContents, type Session } from 'electron'
import { join } from 'node:path'
import { BUILTIN_BLOCKED_DOMAINS } from '../../shared/content-blocking'
import {
  DEFAULT_FILTER_LISTS,
  filterListFor,
  isFilterListId,
  type FilterListId
} from '../../shared/filter-lists'
import type {
  ContentBlockingHostCount,
  ContentBlockingStats,
  CustomFilterFile
} from '../../shared/types'
import { isExtensionApiShuttingDown, onceCallback } from '../extensions/api/events'
import { getSettings, profileDataDir, setSettings } from '../store'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'

/**
 * Built-in ad/tracker domain blocklist.
 *
 * Matching is done on the full hostname: an entry blocks the domain itself
 * and every subdomain of it (`metrics.example.com` matches `example.com`).
 */
export const BLOCKED_DOMAINS = BUILTIN_BLOCKED_DOMAINS

/** Per-profile merged domain sets; profiles can toggle blocking independently. */
const blockedByProfile = new Map<string, Set<string>>()

function blockedSet(profileId: string): Set<string> {
  let set = blockedByProfile.get(profileId)
  if (!set) {
    set = new Set<string>(BLOCKED_DOMAINS)
    blockedByProfile.set(profileId, set)
  }
  return set
}

/** True when `hostname` is a blocked domain or a subdomain of one. */
export function isBlockedHost(profileId: string, hostname: string): boolean {
  const exact = blockedSet(profileId)
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  for (let i = 0; i < labels.length; i += 1) {
    if (exact.has(labels.slice(i).join('.'))) return true
  }
  return false
}

interface RemoteBlocklistCacheEntry {
  fetchedAt: number
  domains: string[]
  /** Source URL, stored for custom lists so cache keys remain meaningful. */
  url?: string
}

interface RemoteBlocklistCacheFile {
  lists?: Record<string, RemoteBlocklistCacheEntry>
  /** Legacy single-list cache written before filter lists were selectable. */
  fetchedAt?: number
  domains?: string[]
}

const BLOCKLIST_CACHE_FILE = 'blocklists-cache.json'
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
// Catalog lists come from known upstreams: a suddenly tiny result likely means
// a broken response, so keep the size guard there. User-supplied lists only
// need one valid domain, matching local hosts-file imports.
const MIN_CATALOG_DOMAINS = 100
const MIN_USER_LIST_DOMAINS = 1
const CUSTOM_CACHE_PREFIX = 'custom:'
const FILE_CACHE_PREFIX = 'file:'

const primedProfiles = new Set<string>()
const refreshInProgress = new Set<string>()

function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (!domain || !domain.includes('.')) return null
  if (domain === 'localhost' || domain.endsWith('.localhost')) return null
  if (domain.startsWith('[') || domain.endsWith(']')) return null
  if (!/^[a-z0-9.-]+$/.test(domain)) return null
  return domain
}

export function parseHostsBlocklist(text: string): string[] {
  const domains = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim()
    if (!line) continue
    const fields = line.split(/\s+/)
    if (fields.length < 2) continue
    const address = fields[0]
    if (address !== '0.0.0.0' && address !== '127.0.0.1') continue
    for (const candidate of fields.slice(1)) {
      const domain = normalizeDomain(candidate)
      if (domain) domains.add(domain)
    }
  }
  return [...domains]
}

/** Normalize a user-provided custom hosts list URL; http/https only. */
export function normalizeCustomFilterUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.toString()
}

function customCacheKey(url: string): string {
  return `${CUSTOM_CACHE_PREFIX}${url}`
}

function cachePathFor(profileId: string): string {
  return join(profileDataDir(profileId), BLOCKLIST_CACHE_FILE)
}

function isKnownCacheKey(id: string): boolean {
  return (
    isFilterListId(id) || id.startsWith(CUSTOM_CACHE_PREFIX) || id.startsWith(FILE_CACHE_PREFIX)
  )
}

function readCachedLists(profileId: string): Map<string, RemoteBlocklistCacheEntry> {
  const file = readJsonFile<RemoteBlocklistCacheFile>(cachePathFor(profileId), {})
  const lists = new Map<string, RemoteBlocklistCacheEntry>()
  if (file.lists && typeof file.lists === 'object') {
    for (const [id, entry] of Object.entries(file.lists)) {
      if (!isKnownCacheKey(id) || !entry || !Array.isArray(entry.domains)) continue
      lists.set(id, {
        fetchedAt: typeof entry.fetchedAt === 'number' ? entry.fetchedAt : 0,
        domains: entry.domains.filter((domain): domain is string => typeof domain === 'string'),
        url: typeof entry.url === 'string' ? entry.url : undefined
      })
    }
  } else if (Array.isArray(file.domains)) {
    // Migrate the legacy single-list cache to the current catalog list.
    lists.set(DEFAULT_FILTER_LISTS[0], {
      fetchedAt: typeof file.fetchedAt === 'number' ? file.fetchedAt : 0,
      domains: file.domains.filter((domain): domain is string => typeof domain === 'string')
    })
  }
  return lists
}

function writeCachedLists(profileId: string, lists: Map<string, RemoteBlocklistCacheEntry>): void {
  const out: Record<string, RemoteBlocklistCacheEntry> = {}
  for (const [id, entry] of lists) {
    if (isKnownCacheKey(id)) out[id] = entry
  }
  writeJsonFile(cachePathFor(profileId), { lists: out })
}

export function builtinFilterListEnabled(profileId: string): boolean {
  return (getSettings(profileId, 'builtinFilterList', true) as boolean) !== false
}

export function enabledFilterLists(profileId: string): FilterListId[] {
  const stored = getSettings(profileId, 'filterLists', [...DEFAULT_FILTER_LISTS])
  if (!Array.isArray(stored)) return [...DEFAULT_FILTER_LISTS]
  return stored.filter((id): id is FilterListId => typeof id === 'string' && isFilterListId(id))
}

export function enabledCustomFilterLists(profileId: string): string[] {
  const stored = getSettings(profileId, 'customFilterLists', [])
  if (!Array.isArray(stored)) return []
  const urls = stored
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeCustomFilterUrl(entry))
    .filter((entry): entry is string => entry !== null)
  return [...new Set(urls)]
}

/** Reasons user-added remote lists could not be applied, by normalized URL. */
export function customFilterListErrors(profileId: string): Record<string, string> {
  const stored = getSettings(profileId, 'customFilterListErrors', {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const errors: Record<string, string> = {}
  for (const [url, message] of Object.entries(stored as Record<string, unknown>)) {
    const normalized = normalizeCustomFilterUrl(url)
    if (normalized && typeof message === 'string') errors[normalized] = message
  }
  return errors
}

type FilterListStatusListener = (profileId: string) => void
let filterListStatusListener: FilterListStatusListener | null = null

/** Let the IPC layer publish refreshed custom-list status to the Settings UI. */
export function setFilterListStatusListener(listener: FilterListStatusListener | null): void {
  filterListStatusListener = listener
}

function setCustomFilterListError(profileId: string, url: string, message: string): void {
  const normalized = normalizeCustomFilterUrl(url)
  // The list can be removed while its request is in flight. Do not resurrect
  // an error for a URL the profile no longer has selected.
  if (!normalized || !enabledCustomFilterLists(profileId).includes(normalized)) return
  const errors = customFilterListErrors(profileId)
  if (errors[normalized] === message) return
  errors[normalized] = message
  setSettings(profileId, 'customFilterListErrors', errors)
  filterListStatusListener?.(profileId)
}

function clearCustomFilterListError(profileId: string, url: string): void {
  const normalized = normalizeCustomFilterUrl(url)
  if (!normalized) return
  const errors = customFilterListErrors(profileId)
  if (!(normalized in errors)) return
  delete errors[normalized]
  setSettings(profileId, 'customFilterListErrors', errors)
  filterListStatusListener?.(profileId)
}

function pruneCustomFilterListErrors(profileId: string, customUrls: string[]): void {
  const errors = customFilterListErrors(profileId)
  const enabled = new Set(customUrls)
  let changed = false
  for (const url of Object.keys(errors)) {
    if (enabled.has(url)) continue
    delete errors[url]
    changed = true
  }
  if (!changed) return
  setSettings(profileId, 'customFilterListErrors', errors)
  filterListStatusListener?.(profileId)
}

export function enabledCustomFilterFiles(profileId: string): CustomFilterFile[] {
  const stored = getSettings(profileId, 'customFilterFiles', [])
  if (!Array.isArray(stored)) return []
  return stored.filter(
    (entry): entry is CustomFilterFile =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as CustomFilterFile).id === 'string' &&
      typeof (entry as CustomFilterFile).name === 'string' &&
      typeof (entry as CustomFilterFile).addedAt === 'number'
  )
}

/** Add domains into an existing set without spreading a large source array. */
function addDomains(target: Set<string>, domains: Iterable<string>): void {
  for (const domain of domains) {
    const normalized = normalizeDomain(domain)
    if (normalized) target.add(normalized)
  }
}

/** Rebuild the active block set from enabled built-in + catalog + custom lists/files. */
function mergeEnabledLists(
  profileId: string,
  builtinEnabled: boolean,
  catalogIds: FilterListId[],
  customUrls: string[],
  customFiles: CustomFilterFile[]
): void {
  const next = builtinEnabled ? new Set<string>(BLOCKED_DOMAINS) : new Set<string>()
  const cached = readCachedLists(profileId)
  for (const id of catalogIds) {
    const entry = cached.get(id)
    if (entry) addDomains(next, entry.domains)
  }
  for (const url of customUrls) {
    const entry = cached.get(customCacheKey(url))
    if (entry) addDomains(next, entry.domains)
  }
  for (const file of customFiles) {
    const entry = cached.get(`${FILE_CACHE_PREFIX}${file.id}`)
    if (entry) addDomains(next, entry.domains)
  }
  blockedByProfile.set(profileId, next)
}

interface RefreshTarget {
  key: string
  url: string
}

function refreshKey(profileId: string, key: string): string {
  return `${profileId}\n${key}`
}

async function refreshRemoteBlocklist(profileId: string, target: RefreshTarget): Promise<void> {
  const rk = refreshKey(profileId, target.key)
  if (refreshInProgress.has(rk)) return
  refreshInProgress.add(rk)
  const isCustom = target.key.startsWith(CUSTOM_CACHE_PREFIX)
  const minDomains = isCustom ? MIN_USER_LIST_DOMAINS : MIN_CATALOG_DOMAINS
  try {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      if (isCustom) {
        setCustomFilterListError(
          profileId,
          target.url,
          `Could not download the list (HTTP ${response.status}).`
        )
      }
      return
    }
    const domains = parseHostsBlocklist(await response.text())
    if (domains.length < minDomains) {
      if (isCustom) {
        setCustomFilterListError(
          profileId,
          target.url,
          'No valid hosts entries were found. The list needs at least one domain.'
        )
      }
      return
    }
    clearCustomFilterListError(profileId, target.url)
    const cached = readCachedLists(profileId)
    cached.set(target.key, { fetchedAt: Date.now(), domains, url: target.url })
    writeCachedLists(profileId, cached)
    // The selection may have changed while the request was in flight.
    mergeEnabledLists(
      profileId,
      builtinFilterListEnabled(profileId),
      enabledFilterLists(profileId),
      enabledCustomFilterLists(profileId),
      enabledCustomFilterFiles(profileId)
    )
  } catch {
    // Network or storage failures fall back to whatever is already cached.
    if (isCustom) {
      setCustomFilterListError(profileId, target.url, 'Could not apply the list. Check the URL.')
    }
  } finally {
    refreshInProgress.delete(rk)
  }
}

function refreshIfNeeded(
  profileId: string,
  catalogIds: FilterListId[],
  customUrls: string[]
): void {
  const cached = readCachedLists(profileId)
  const now = Date.now()
  const targets: RefreshTarget[] = []
  for (const id of catalogIds) {
    const list = filterListFor(id)
    if (list) targets.push({ key: id, url: list.url })
  }
  for (const url of customUrls) targets.push({ key: customCacheKey(url), url })
  for (const target of targets) {
    const entry = cached.get(target.key)
    const stale = now - (entry?.fetchedAt ?? 0) > REFRESH_INTERVAL_MS
    if (!entry || entry.domains.length === 0 || stale) {
      void refreshRemoteBlocklist(profileId, target)
    }
  }
}

function currentConfig(profileId: string): {
  builtin: boolean
  catalogIds: FilterListId[]
  customUrls: string[]
  customFiles: CustomFilterFile[]
} {
  return {
    builtin: builtinFilterListEnabled(profileId),
    catalogIds: enabledFilterLists(profileId),
    customUrls: enabledCustomFilterLists(profileId),
    customFiles: enabledCustomFilterFiles(profileId)
  }
}

/**
 * Prime a profile's content blocker from the cached lists and refresh stale
 * or missing selections in the background. Safe to call multiple times and
 * never blocks the caller on network I/O.
 */
export function primeContentBlocking(profileId: string): void {
  if (primedProfiles.has(profileId)) return
  primedProfiles.add(profileId)
  const config = currentConfig(profileId)
  pruneCustomFilterListErrors(profileId, config.customUrls)
  mergeEnabledLists(
    profileId,
    config.builtin,
    config.catalogIds,
    config.customUrls,
    config.customFiles
  )
  refreshIfNeeded(profileId, config.catalogIds, config.customUrls)
}

/**
 * Re-apply the selected filter lists and fetch any newly enabled list. Called
 * when Settings toggles change so blocking updates without a restart.
 */
export function syncContentBlocking(profileId: string): void {
  const config = currentConfig(profileId)
  pruneCustomFilterListErrors(profileId, config.customUrls)
  mergeEnabledLists(
    profileId,
    config.builtin,
    config.catalogIds,
    config.customUrls,
    config.customFiles
  )
  refreshIfNeeded(profileId, config.catalogIds, config.customUrls)
}

/** Parse and store an imported hosts file, returning its metadata. */
export function importCustomFilterFile(
  profileId: string,
  name: string,
  content: string
): CustomFilterFile {
  const domains = parseHostsBlocklist(content)
  if (domains.length < MIN_USER_LIST_DOMAINS) {
    throw new Error('No valid hosts entries were found in that file.')
  }
  const file: CustomFilterFile = {
    id: randomUUID(),
    name: (name || 'Custom hosts list').trim().slice(0, 120) || 'Custom hosts list',
    addedAt: Date.now()
  }
  const cached = readCachedLists(profileId)
  cached.set(`${FILE_CACHE_PREFIX}${file.id}`, {
    fetchedAt: Date.now(),
    domains,
    url: file.name
  })
  writeCachedLists(profileId, cached)
  return file
}

/** Remove a cached imported hosts file entry. */
export function removeCustomFilterFile(profileId: string, id: string): void {
  const cached = readCachedLists(profileId)
  cached.delete(`${FILE_CACHE_PREFIX}${id}`)
  writeCachedLists(profileId, cached)
}

/** Turn a URL or hostname into the lowercase hostname used for exceptions. */
export function normalizeBlockingHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const host = new URL(trimmed).hostname
    if (host) return host
  } catch {
    // Fall through to plain hostname handling.
  }
  if (/^(about|data|blob|javascript|file|voyager|chrome|devtools):/i.test(trimmed)) return null
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end > 1 ? trimmed.slice(0, end + 1) : null
  }
  const host = trimmed.split('/')[0]?.split(':')[0]?.replace(/\.$/, '') ?? ''
  return host || null
}

const exceptionsCache = new Map<string, string[]>()

/** Hostnames where tracker blocking is turned off for a profile. */
export function contentBlockingExceptions(profileId: string): string[] {
  const cached = exceptionsCache.get(profileId)
  if (cached) return cached
  const stored = getSettings(profileId, 'contentBlockingExceptions', [])
  const hosts = Array.isArray(stored)
    ? stored.map((entry) => (typeof entry === 'string' ? normalizeBlockingHost(entry) : null))
    : []
  const normalized = [...new Set(hosts.filter((host): host is string => host !== null))].sort()
  exceptionsCache.set(profileId, normalized)
  return normalized
}

/** Replace a profile's exception list after normalizing and de-duplicating it. */
export function setContentBlockingExceptions(profileId: string, hosts: string[]): string[] {
  const normalized = [
    ...new Set(
      hosts
        .map((entry) => normalizeBlockingHost(entry))
        .filter((host): host is string => host !== null)
    )
  ].sort()
  setSettings(profileId, 'contentBlockingExceptions', normalized)
  exceptionsCache.set(profileId, normalized)
  return normalized
}

function isContentBlockingExempt(profileId: string, hostname: string): boolean {
  return contentBlockingExceptions(profileId).includes(hostname)
}

/** Turn tracker blocking on or off for one hostname. */
export function setContentBlockingSiteEnabled(
  profileId: string,
  site: string,
  enabled: boolean
): void {
  const host = normalizeBlockingHost(site)
  if (!host) throw new Error('Invalid site hostname')
  const next = new Set(contentBlockingExceptions(profileId))
  if (enabled) next.delete(host)
  else next.add(host)
  setContentBlockingExceptions(profileId, [...next])
}

interface BlockingCounters {
  blocked: number
  hosts: Map<string, number>
}

interface PageBlockingCounters extends BlockingCounters {
  profileId: string
  statsKey: string
  site: string | null
}

const MAX_TRACKED_HOSTS = 100
const TOP_HOSTS_LIMIT = 5

const pageCounters = new Map<number, PageBlockingCounters>()
const sessionCounters = new Map<string, BlockingCounters>()
/** Incognito sessions get a unique key so their hosts never reach the profile dashboard. */
const sessionStatsKeys = new WeakMap<Session, string>()

function newCounters(): BlockingCounters {
  return { blocked: 0, hosts: new Map() }
}

function sessionCountersFor(statsKey: string): BlockingCounters {
  let counters = sessionCounters.get(statsKey)
  if (!counters) {
    counters = newCounters()
    sessionCounters.set(statsKey, counters)
  }
  return counters
}

function statsKeyFor(ses: Session | undefined, profileId: string): string {
  return (ses && sessionStatsKeys.get(ses)) || profileId
}

function sessionForPage(id: number): Session | undefined {
  return webContents.fromId(id)?.session
}

/** Discard every counter collected by a private session. */
export function clearContentBlockingSession(ses: Session): void {
  const statsKey = sessionStatsKeys.get(ses)
  if (!statsKey) return
  sessionCounters.delete(statsKey)
  for (const [webContentsId, page] of pageCounters) {
    if (page.statsKey === statsKey) pageCounters.delete(webContentsId)
  }
}

/** Keep per-host maps bounded so long sessions cannot grow without limit. */
function incrementHost(hosts: Map<string, number>, host: string): void {
  const current = hosts.get(host)
  if (current !== undefined) {
    hosts.set(host, current + 1)
  } else if (hosts.size < MAX_TRACKED_HOSTS) {
    hosts.set(host, 1)
  }
}

function topHosts(hosts: Map<string, number>): ContentBlockingHostCount[] {
  return [...hosts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_HOSTS_LIMIT)
    .map(([host, count]) => ({ host, count }))
}

/** Start fresh counters for a page load; called when a tab navigates. */
export function resetContentBlockingPage(
  webContentsId: number,
  profileId: string,
  url: string
): void {
  pageCounters.set(webContentsId, {
    profileId,
    statsKey: statsKeyFor(sessionForPage(webContentsId), profileId),
    site: normalizeBlockingHost(url),
    blocked: 0,
    hosts: new Map()
  })
}

/** Update the page's site without discarding counters collected so far. */
export function trackContentBlockingPage(
  webContentsId: number,
  profileId: string,
  url: string
): void {
  const page = pageCounters.get(webContentsId)
  if (!page) {
    resetContentBlockingPage(webContentsId, profileId, url)
    return
  }
  page.profileId = profileId
  page.statsKey = statsKeyFor(sessionForPage(webContentsId), profileId)
  page.site = normalizeBlockingHost(url)
}

/** Drop per-page counters when a tab's WebContents is destroyed. */
export function clearContentBlockingPage(webContentsId: number): void {
  pageCounters.delete(webContentsId)
}

/** Snapshot of tracker-blocking activity for a profile/session and, optionally, a page. */
export function contentBlockingStats(
  profileId: string,
  webContentsId?: number | null,
  statsKeyOverride?: string
): ContentBlockingStats {
  const statsKey = statsKeyOverride ?? profileId
  const snapshot = sessionCounters.get(statsKey) ?? newCounters()
  const page =
    webContentsId === undefined || webContentsId === null
      ? undefined
      : pageCounters.get(webContentsId)
  const scopedPage = page?.statsKey === statsKey ? page : undefined
  const exceptions = contentBlockingExceptions(profileId)
  const site = scopedPage?.site ?? null
  return {
    enabled: (getSettings(profileId, 'contentBlocking', false) as boolean) === true,
    sessionBlocked: snapshot.blocked,
    topHosts: topHosts(snapshot.hosts),
    pageBlocked: scopedPage?.blocked ?? 0,
    pageHosts: topHosts(scopedPage?.hosts ?? new Map()),
    site,
    siteEnabled: site === null || !exceptions.includes(site),
    exceptions
  }
}

function recordBlockedRequest(
  statsKey: string,
  webContentsId: number | undefined,
  hostname: string
): void {
  const snapshot = sessionCountersFor(statsKey)
  snapshot.blocked += 1
  incrementHost(snapshot.hosts, hostname)
  if (webContentsId === undefined) return
  const page = pageCounters.get(webContentsId)
  if (!page) return
  page.blocked += 1
  incrementHost(page.hosts, hostname)
}

const attachedSessions = new WeakSet<Session>()

/**
 * Attach the ad/tracker request filter to a session. Idempotent. Requests
 * are cancelled before they hit the network; top-level navigations are never
 * cancelled so links and typed URLs keep working. The persisted
 * `contentBlocking` preference is consulted per request, so toggling it in
 * Settings applies immediately without restarting.
 */
export function attachContentBlocking(
  ses: Session,
  profileId: string,
  options: { statsKey?: string } = {}
): void {
  if (attachedSessions.has(ses)) return
  attachedSessions.add(ses)
  // Rules and exceptions stay profile-scoped; only the counters are isolated.
  const statsKey = options.statsKey ?? profileId
  sessionStatsKeys.set(ses, statsKey)

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const done = onceCallback(callback)
    const passthrough = (): void => done({ cancel: false })
    if (isExtensionApiShuttingDown()) {
      passthrough()
      return
    }
    try {
      if ((getSettings(profileId, 'contentBlocking', false) as boolean) !== true) {
        passthrough()
        return
      }
      if (details.resourceType === 'mainFrame') {
        passthrough()
        return
      }
      const webContentsId = details.webContentsId
      const page = webContentsId === undefined ? undefined : pageCounters.get(webContentsId)
      // A site exception disables blocking for every request the page makes.
      if (page?.site && isContentBlockingExempt(profileId, page.site)) {
        passthrough()
        return
      }
      let hostname: string | null
      try {
        hostname = new URL(details.url).hostname
      } catch {
        hostname = null
      }
      if (hostname === null || !isBlockedHost(profileId, hostname)) {
        passthrough()
        return
      }
      recordBlockedRequest(statsKey, webContentsId, hostname)
      done({ cancel: true })
    } catch {
      passthrough()
    }
  })
}
