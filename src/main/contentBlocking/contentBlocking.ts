import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'
import {
  DEFAULT_FILTER_LISTS,
  filterListFor,
  isFilterListId,
  type FilterListId
} from '../../shared/filter-lists'
import type { CustomFilterFile } from '../../shared/types'
import { getSettings } from '../store'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'

/**
 * Built-in ad/tracker domain blocklist.
 *
 * Matching is done on the full hostname: an entry blocks the domain itself
 * and every subdomain of it (`metrics.example.com` matches `example.com`).
 * This is a curated starter set of well-known advertising and analytics
 * domains — broad enough to be useful, conservative enough to avoid breaking
 * ordinary site functionality. Site functionality domains (CDNs, fonts,
 * login providers, APIs) are deliberately not listed.
 */
import { BUILTIN_BLOCKED_DOMAINS } from '../../shared/content-blocking'

export const BLOCKED_DOMAINS = BUILTIN_BLOCKED_DOMAINS

let blockedExact = new Set<string>(BLOCKED_DOMAINS)

/** True when `hostname` is a blocked domain or a subdomain of one. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  for (let i = 0; i < labels.length; i += 1) {
    if (blockedExact.has(labels.slice(i).join('.'))) return true
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

let primeStarted = false
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
export function normalizeCustomFilterUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function customCacheKey(url: string): string {
  return `${CUSTOM_CACHE_PREFIX}${url}`
}

function cachePathFor(userDataPath: string): string {
  return join(userDataPath, BLOCKLIST_CACHE_FILE)
}

function isKnownCacheKey(id: string): boolean {
  return isFilterListId(id) || id.startsWith(CUSTOM_CACHE_PREFIX) || id.startsWith(FILE_CACHE_PREFIX)
}

function readCachedLists(userDataPath: string): Map<string, RemoteBlocklistCacheEntry> {
  const raw = readJsonFile<RemoteBlocklistCacheFile>(cachePathFor(userDataPath), {})
  const lists = new Map<string, RemoteBlocklistCacheEntry>()
  for (const [id, entry] of Object.entries(raw.lists ?? {})) {
    if (!entry || !Array.isArray(entry.domains)) continue
    if (!isKnownCacheKey(id)) continue
    lists.set(id, {
      fetchedAt: typeof entry.fetchedAt === 'number' ? entry.fetchedAt : 0,
      domains: entry.domains,
      ...(typeof entry.url === 'string' ? { url: entry.url } : {})
    })
  }
  // Migrate the old single-list cache into the AdAway slot.
  if (lists.size === 0 && Array.isArray(raw.domains) && raw.domains.length > 0) {
    lists.set('adaway', {
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0,
      domains: raw.domains
    })
  }
  return lists
}

function writeCachedLists(
  userDataPath: string,
  lists: Map<string, RemoteBlocklistCacheEntry>
): void {
  const serialized: Record<string, RemoteBlocklistCacheEntry> = {}
  for (const [id, entry] of lists) serialized[id] = entry
  writeJsonFile(cachePathFor(userDataPath), { lists: serialized })
}

/** Catalog filter lists selected in Settings, falling back to the previous default. */
export function enabledFilterLists(): FilterListId[] {
  const stored = getSettings<unknown>('filterLists')
  if (!Array.isArray(stored)) return [...DEFAULT_FILTER_LISTS]
  const unique = new Set<FilterListId>()
  for (const value of stored) {
    if (isFilterListId(value)) unique.add(value)
  }
  return [...unique]
}

export function builtinFilterListEnabled(): boolean {
  return getSettings('builtinFilterList', true) !== false
}

/** Custom hosts-list URLs configured by the user (http/https only). */
export function enabledCustomFilterLists(): string[] {
  const stored = getSettings<unknown>('customFilterLists')
  if (!Array.isArray(stored)) return []
  const unique = new Set<string>()
  for (const value of stored) {
    const url = normalizeCustomFilterUrl(value)
    if (url) unique.add(url)
  }
  return [...unique]
}

/** Imported hosts files stored locally. */
export function enabledCustomFilterFiles(): CustomFilterFile[] {
  const stored = getSettings<unknown>('customFilterFiles')
  if (!Array.isArray(stored)) return []
  const files: CustomFilterFile[] = []
  const seen = new Set<string>()
  for (const value of stored) {
    if (!value || typeof value !== 'object') continue
    const item = value as Partial<CustomFilterFile>
    if (typeof item.id !== 'string' || item.id.trim() === '' || seen.has(item.id)) continue
    if (typeof item.name !== 'string' || item.name.trim() === '') continue
    seen.add(item.id)
    files.push({
      id: item.id,
      name: item.name.trim(),
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now()
    })
  }
  return files
}

function addDomains(target: Set<string>, domains: readonly string[]): void {
  for (let i = 0; i < domains.length; i += 1) {
    const normalized = normalizeDomain(domains[i])
    if (normalized) target.add(normalized)
  }
}

/** Rebuild the active block set from enabled built-in + catalog + custom lists/files. */
function mergeEnabledLists(
  userDataPath: string,
  builtinEnabled: boolean,
  catalogIds: FilterListId[],
  customUrls: string[],
  customFiles: CustomFilterFile[]
): void {
  const next = builtinEnabled ? new Set<string>(BLOCKED_DOMAINS) : new Set<string>()
  const cached = readCachedLists(userDataPath)
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
  blockedExact = next
}

interface RefreshTarget {
  key: string
  url: string
}

async function refreshRemoteBlocklist(userDataPath: string, target: RefreshTarget): Promise<void> {
  if (refreshInProgress.has(target.key)) return
  refreshInProgress.add(target.key)
  try {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return
    const domains = parseHostsBlocklist(await response.text())
    if (domains.length < MIN_REMOTE_DOMAINS) return
    const cached = readCachedLists(userDataPath)
    cached.set(target.key, { fetchedAt: Date.now(), domains, url: target.url })
    writeCachedLists(userDataPath, cached)
    // The selection may have changed while the request was in flight.
    mergeEnabledLists(
      userDataPath,
      builtinFilterListEnabled(),
      enabledFilterLists(),
      enabledCustomFilterLists(),
      enabledCustomFilterFiles()
    )
  } catch {
    // Network or storage failures fall back to whatever is already cached.
  } finally {
    refreshInProgress.delete(target.key)
  }
}

function refreshIfNeeded(
  userDataPath: string,
  catalogIds: FilterListId[],
  customUrls: string[]
): void {
  const cached = readCachedLists(userDataPath)
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
      void refreshRemoteBlocklist(userDataPath, target)
    }
  }
}

function currentConfig(): {
  builtin: boolean
  catalogIds: FilterListId[]
  customUrls: string[]
  customFiles: CustomFilterFile[]
} {
  return {
    builtin: builtinFilterListEnabled(),
    catalogIds: enabledFilterLists(),
    customUrls: enabledCustomFilterLists(),
    customFiles: enabledCustomFilterFiles()
  }
}

/**
 * Prime the content blocker from the cached lists and refresh stale or missing
 * selections in the background. Safe to call multiple times and never blocks
 * the caller on network I/O.
 */
export function primeContentBlocking(userDataPath?: string): void {
  if (primeStarted) return
  primeStarted = true
  const directory = userDataPath ?? app.getPath('userData')
  const config = currentConfig()
  mergeEnabledLists(
    directory,
    config.builtin,
    config.catalogIds,
    config.customUrls,
    config.customFiles
  )
  refreshIfNeeded(directory, config.catalogIds, config.customUrls)
}

/**
 * Re-apply the selected filter lists and fetch any newly enabled list. Called
 * when the Settings toggles change so blocking updates without a restart.
 */
export function syncContentBlocking(userDataPath?: string): void {
  const directory = userDataPath ?? app.getPath('userData')
  const config = currentConfig()
  mergeEnabledLists(
    directory,
    config.builtin,
    config.catalogIds,
    config.customUrls,
    config.customFiles
  )
  refreshIfNeeded(directory, config.catalogIds, config.customUrls)
}

/** Parse and store an imported hosts file, returning its metadata. */
export function importCustomFilterFile(
  name: string,
  content: string,
  userDataPath?: string
): CustomFilterFile {
  const domains = parseHostsBlocklist(content)
  if (domains.length < MIN_IMPORTED_DOMAINS) {
    throw new Error('No valid hosts entries were found in that file.')
  }
  const directory = userDataPath ?? app.getPath('userData')
  const file: CustomFilterFile = {
    id: randomUUID(),
    name: (name || 'Custom hosts list').trim().slice(0, 120) || 'Custom hosts list',
    addedAt: Date.now()
  }
  const cached = readCachedLists(directory)
  cached.set(`${FILE_CACHE_PREFIX}${file.id}`, {
    fetchedAt: Date.now(),
    domains,
    url: file.name
  })
  writeCachedLists(directory, cached)
  syncContentBlocking(directory)
  return file
}

/** Remove an imported hosts file and its cached domains. */
export function removeCustomFilterFile(id: string, userDataPath?: string): void {
  const directory = userDataPath ?? app.getPath('userData')
  const cached = readCachedLists(directory)
  cached.delete(`${FILE_CACHE_PREFIX}${id}`)
  writeCachedLists(directory, cached)
  syncContentBlocking(directory)
}

const attachedSessions = new WeakSet<Session>()

/**
 * Attach the ad/tracker request filter to a session. Idempotent. Requests
 * are cancelled before they hit the network; top-level navigations are never
 * cancelled so links and typed URLs keep working. The persisted
 * `contentBlocking` preference is consulted per request, so toggling it in
 * Settings applies immediately without restarting.
 */
export function attachContentBlocking(ses: Session): void {
  if (attachedSessions.has(ses)) return
  attachedSessions.add(ses)

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (getSettings('contentBlocking', false) === false) {
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
    callback({ cancel: hostname !== null && isBlockedHost(hostname) })
  })
}
