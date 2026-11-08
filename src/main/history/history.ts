import { randomUUID } from 'node:crypto'
import type { HistoryEntry, HistoryState } from '../../shared/types'
import { storesFor } from '../store'

export function currentHistoryState(profileId: string): HistoryState {
  const entries = storesFor(profileId).history.get('entries')
  // Return most recent first.
  return { entries: [...entries].sort((a, b) => b.visitedAt - a.visitedAt) }
}

export function recordVisit(
  profileId: string,
  input: { url: string; title: string }
): HistoryEntry {
  const store = storesFor(profileId).history
  const url = input.url
  const title = input.title || url
  const entries = store.get('entries')
  const existing = entries.find((item) => item.url === url)

  if (existing) {
    existing.visitCount += 1
    existing.visitedAt = Date.now()
    existing.title = title
    store.set('entries', entries)
    return existing
  }

  const entry: HistoryEntry = {
    id: randomUUID(),
    url,
    title,
    visitedAt: Date.now(),
    visitCount: 1
  }
  store.update('entries', (list) => [...list, entry])
  return entry
}

export function removeHistory(profileId: string, id: string): void {
  storesFor(profileId).history.update('entries', (list) =>
    list.filter((item) => item.id !== id)
  )
}

export function clearHistory(profileId: string): void {
  storesFor(profileId).history.set('entries', [])
}

export function updateHistoryTitle(
  profileId: string,
  url: string,
  title: string
): boolean {
  const nextTitle = title.trim()
  if (!url || !nextTitle) return false
  const store = storesFor(profileId).history
  const entries = store.get('entries')
  const existing = entries.find((entry) => entry.url === url)
  if (!existing || existing.title === nextTitle) return false
  existing.title = nextTitle
  store.set('entries', entries)
  return true
}

export function publishHistory(
  profileId: string,
  broadcast: (state: HistoryState) => void
): HistoryState {
  const state = currentHistoryState(profileId)
  broadcast(state)
  return state
}
