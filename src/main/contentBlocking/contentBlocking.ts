import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import { join } from 'node:path'
import { BUILTIN_BLOCKED_DOMAINS } from '../../shared/content-blocking'
import {
  DEFAULT_FILTER_LISTS,
  filterListFor,
  isFilterListId,
  type FilterListId
} from '../../shared/filter-lists'
import type { CustomFilterFile } from '../../shared/types'
import { getSettings, profileDataDir } from '../store'
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
const MIN_REMOTE_DOMAINS = 100
const MIN_IMPORTED_DOMAINS = 1
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
  try {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return
    const domains = parseHostsBlocklist(await response.text())
    if (domains.length < MIN_REMOTE_DOMAINS) return
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
  if (domains.length < MIN_IMPORTED_DOMAINS) {
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

const attachedSessions = new WeakSet<Session>()

/**
 * Attach the ad/tracker request filter to a session. Idempotent. Requests
 * are cancelled before they hit the network; top-level navigations are never
 * cancelled so links and typed URLs keep working. The persisted
 * `contentBlocking` preference is consulted per request, so toggling it in
 * Settings applies immediately without restarting.
 */
export function attachContentBlocking(ses: Session, profileId: string): void {
  if (attachedSessions.has(ses)) return
  attachedSessions.add(ses)

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if ((getSettings(profileId, 'contentBlocking', false) as boolean) !== true) {
      callback({ cancel: false })
      return
    }
    if (details.resourceType === 'mainFrame') {
      callback({ cancel: false })
      return
    }
    let hostname: string | null
    try {
      hostname = new URL(details.url).hostname
    } catch {
      hostname = null
    }
    callback({ cancel: hostname !== null && isBlockedHost(profileId, hostname) })
  })
}
