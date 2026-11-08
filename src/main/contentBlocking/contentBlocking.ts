import type { Session } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'
import {
  DEFAULT_FILTER_LISTS,
  filterListFor,
  isFilterListId,
  type FilterListId,
  type FilterListInfo
} from '../../shared/filter-lists'
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

let primeStarted = false
const refreshInProgress = new Set<FilterListId>()

function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (!domain || !domain.includes('.')) return null
  if (domain === 'localhost' || domain.endsWith('.localhost')) return null
  if (domain.startsWith('[') || domain.endsWith(']')) return null
  if (!/^[a-z0-9.-]+$/.test(domain)) return null
  return domain
}

function parseHostsBlocklist(text: string): string[] {
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

function cachePathFor(userDataPath: string): string {
  return join(userDataPath, BLOCKLIST_CACHE_FILE)
}

function readCachedLists(userDataPath: string): Map<FilterListId, RemoteBlocklistCacheEntry> {
  const raw = readJsonFile<RemoteBlocklistCacheFile>(cachePathFor(userDataPath), {})
  const lists = new Map<FilterListId, RemoteBlocklistCacheEntry>()
  for (const [id, entry] of Object.entries(raw.lists ?? {})) {
    if (!isFilterListId(id)) continue
    if (!entry || !Array.isArray(entry.domains)) continue
    lists.set(id, {
      fetchedAt: typeof entry.fetchedAt === 'number' ? entry.fetchedAt : 0,
      domains: entry.domains
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
  lists: Map<FilterListId, RemoteBlocklistCacheEntry>
): void {
  const serialized: Record<string, RemoteBlocklistCacheEntry> = {}
  for (const [id, entry] of lists) serialized[id] = entry
  writeJsonFile(cachePathFor(userDataPath), { lists: serialized })
}

/** Filter lists selected in Settings, falling back to the previous default. */
export function enabledFilterLists(): FilterListId[] {
  const stored = getSettings<unknown>('filterLists')
  if (!Array.isArray(stored)) return [...DEFAULT_FILTER_LISTS]
  const unique = new Set<FilterListId>()
  for (const value of stored) {
    if (isFilterListId(value)) unique.add(value)
  }
  return [...unique]
}

function mergeDomainSet(domains: string[]): void {
  const next = new Set<string>(BLOCKED_DOMAINS)
  for (const domain of domains) {
    const normalized = normalizeDomain(domain)
    if (normalized) next.add(normalized)
  }
  blockedExact = next
}

/** Rebuild the active block set from the built-in list + enabled cached lists. */
function mergeEnabledLists(userDataPath: string, enabled: FilterListId[]): void {
  if (enabled.length === 0) {
    blockedExact = new Set<string>(BLOCKED_DOMAINS)
    return
  }
  const cached = readCachedLists(userDataPath)
  const domains: string[] = []
  for (const id of enabled) {
    const entry = cached.get(id)
    if (entry) domains.push(...entry.domains)
  }
  mergeDomainSet(domains)
}

async function refreshRemoteBlocklist(userDataPath: string, list: FilterListInfo): Promise<void> {
  if (refreshInProgress.has(list.id)) return
  refreshInProgress.add(list.id)
  try {
    const response = await fetch(list.url, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return
    const domains = parseHostsBlocklist(await response.text())
    if (domains.length < MIN_REMOTE_DOMAINS) return
    const cached = readCachedLists(userDataPath)
    cached.set(list.id, { fetchedAt: Date.now(), domains })
    writeCachedLists(userDataPath, cached)
    // The selection may have changed while the request was in flight.
    mergeEnabledLists(userDataPath, enabledFilterLists())
  } catch {
    // Network or storage failures fall back to whatever is already cached.
  } finally {
    refreshInProgress.delete(list.id)
  }
}

function refreshIfNeeded(userDataPath: string, enabled: FilterListId[]): void {
  const cached = readCachedLists(userDataPath)
  const now = Date.now()
  for (const id of enabled) {
    const entry = cached.get(id)
    const stale = now - (entry?.fetchedAt ?? 0) > REFRESH_INTERVAL_MS
    if (!entry || entry.domains.length === 0 || stale) {
      const list = filterListFor(id)
      if (list) void refreshRemoteBlocklist(userDataPath, list)
    }
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
  const enabled = enabledFilterLists()
  mergeEnabledLists(directory, enabled)
  refreshIfNeeded(directory, enabled)
}

/**
 * Re-apply the selected filter lists and fetch any newly enabled list. Called
 * when the Settings toggles change so blocking updates without a restart.
 */
export function syncContentBlocking(userDataPath?: string): void {
  const directory = userDataPath ?? app.getPath('userData')
  const enabled = enabledFilterLists()
  mergeEnabledLists(directory, enabled)
  refreshIfNeeded(directory, enabled)
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
