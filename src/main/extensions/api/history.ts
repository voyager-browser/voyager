import type { HistoryEntry } from '../../../shared/types'
import {
  clearHistory,
  currentHistoryState,
  recordVisit as upsertHistoryEntry
} from '../../history/history'
import { storesFor } from '../../store'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

const PATH = 'history'

interface ChromeHistoryItem {
  id: string
  url: string
  title: string
  visitCount: number
  lastVisitTime: number
}

interface ChromeVisitItem {
  id: string
  visitId: string
  visitTime: number
  referringVisitId: string
  transition: string
}

interface AddUrlInput {
  url: string
  title?: string
  time?: number
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function detailsFrom(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? { url: value } : record(value)
}

function numberFrom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function urlFrom(details: Record<string, unknown>): string {
  if (typeof details.url === 'string' && details.url.length > 0) return details.url
  throw new Error('A history URL is required')
}

function historyItem(entry: HistoryEntry): ChromeHistoryItem {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    visitCount: entry.visitCount,
    lastVisitTime: entry.visitedAt
  }
}

/** Voyager stores one aggregate per URL, so synthesize stable per-visit ids. */
function visitItems(entry: HistoryEntry): ChromeVisitItem[] {
  const count = Math.max(0, Math.min(1000, Math.floor(entry.visitCount)))
  return Array.from({ length: count }, (_, index) => ({
    id: entry.id,
    visitId: `${entry.id}:${index}`,
    visitTime: Math.max(0, entry.visitedAt - index * 1000),
    referringVisitId: index === 0 ? '0' : `${entry.id}:${index - 1}`,
    transition: 'link'
  }))
}

function emitVisit(profileId: string, entry: HistoryEntry): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: [PATH], event: 'onVisited', args: [historyItem(entry)] },
    PATH
  )
}

function emitRemoval(profileId: string, urls: string[], allHistory: boolean): void {
  broadcastExtensionApiEvent(
    profileId,
    { path: [PATH], event: 'onVisitRemoved', args: [{ allHistory, urls }] },
    PATH
  )
}

/** Exposed so Voyager navigation can notify extensions when it records a visit. */
export function emitHistoryVisit(profileId: string, entry: HistoryEntry): void {
  emitVisit(profileId, entry)
}

/** Exposed so Voyager UI history deletion can notify extensions. */
export function emitHistoryRemoval(profileId: string, urls: string[], allHistory = false): void {
  emitRemoval(profileId, urls, allHistory)
}

function addEntry(profileId: string, input: AddUrlInput): HistoryEntry {
  const entry = upsertHistoryEntry(profileId, {
    url: input.url,
    title: input.title ?? input.url
  })
  if (input.time === undefined) return entry
  const visitedAt = input.time
  storesFor(profileId).history.update('entries', (entries) =>
    entries.map((item) => (item.id === entry.id ? { ...item, visitedAt } : item))
  )
  return { ...entry, visitedAt }
}

function removeMatching(profileId: string, matches: (entry: HistoryEntry) => boolean): string[] {
  const store = storesFor(profileId).history
  const kept: HistoryEntry[] = []
  const removed: string[] = []
  for (const entry of store.get('entries')) {
    if (matches(entry)) removed.push(entry.url)
    else kept.push(entry)
  }
  if (removed.length > 0) store.set('entries', kept)
  return removed
}

export function registerHistory(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(context, method, args): unknown {
      const profileId = context.profileId

      if (method === 'search') {
        const details = detailsFrom(args[0])
        const text = typeof details.text === 'string' ? details.text.toLowerCase() : ''
        const start = numberFrom(details.startTime, 0)
        const end = numberFrom(details.endTime, Date.now())
        const maxResults = Math.max(
          0,
          Math.min(1000, Math.floor(numberFrom(details.maxResults, 100)))
        )
        return currentHistoryState(profileId)
          .entries.filter(
            (entry) =>
              entry.visitedAt >= start &&
              entry.visitedAt <= end &&
              (text.length === 0 ||
                entry.url.toLowerCase().includes(text) ||
                entry.title.toLowerCase().includes(text))
          )
          .slice(0, maxResults)
          .map(historyItem)
      }

      if (method === 'getVisits') {
        const details = detailsFrom(args[0])
        const url = typeof details.url === 'string' ? details.url : null
        const visitId = typeof details.visitId === 'string' ? details.visitId : null
        if (!url && !visitId) return []
        const entryId = visitId?.split(':')[0]
        const entry = currentHistoryState(profileId).entries.find(
          (candidate) => candidate.url === url || candidate.id === entryId
        )
        return entry ? visitItems(entry) : []
      }

      if (method === 'addUrl') {
        const details = detailsFrom(args[0])
        const url = urlFrom(details)
        const title = typeof details.title === 'string' ? details.title : url
        const time = numberFrom(details.time, Date.now())
        const entry = addEntry(profileId, { url, title, time })
        emitVisit(profileId, entry)
        return undefined
      }

      if (method === 'deleteUrl' || method === 'deleteVisits') {
        const details = detailsFrom(args[0])
        const url = typeof details.url === 'string' ? details.url : null
        const visitId = typeof details.visitId === 'string' ? details.visitId : null
        const entryId = visitId?.split(':')[0]
        const removed = removeMatching(profileId, (entry) =>
          Boolean((url && entry.url === url) || (entryId && entry.id === entryId))
        )
        if (removed.length > 0) emitRemoval(profileId, removed, false)
        return undefined
      }

      if (method === 'deleteAll') {
        clearHistory(profileId)
        emitRemoval(profileId, [], true)
        return undefined
      }

      if (method === 'deleteRange') {
        const details = record(args[0])
        const start = numberFrom(details.startTime, 0)
        const end = numberFrom(details.endTime, Number.MAX_SAFE_INTEGER)
        const removed = removeMatching(
          profileId,
          (entry) => entry.visitedAt >= start && entry.visitedAt <= end
        )
        if (removed.length > 0) emitRemoval(profileId, removed, false)
        return undefined
      }

      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
