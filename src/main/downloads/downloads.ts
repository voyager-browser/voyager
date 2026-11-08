import { randomUUID } from 'node:crypto'
import { shell, type DownloadItem as ElectronDownloadItem, type Session } from 'electron'
import type { DownloadItem, DownloadsState } from '../../shared/types'
import { getSettings, storesFor } from '../store'

const trackedSessions = new WeakSet<Session>()
const activeItems = new Map<string, ElectronDownloadItem>()

export function currentDownloadsState(profileId: string): DownloadsState {
  const items = storesFor(profileId).downloads.get('items')
  return {
    items: [...items].sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
  }
}

export function upsertDownload(profileId: string, item: DownloadItem): void {
  const store = storesFor(profileId).downloads
  const items = store.get('items')
  const idx = items.findIndex((it) => it.id === item.id)
  if (idx === -1) {
    store.update('items', (list) => [item, ...list])
    return
  }
  const next = [...items]
  next[idx] = { ...next[idx], ...item }
  store.set('items', next)
}

export function clearDownloads(profileId: string): void {
  storesFor(profileId).downloads.set('items', [])
}

export function publishDownloads(
  profileId: string,
  broadcast: (state: DownloadsState) => void
): DownloadsState {
  const state = currentDownloadsState(profileId)
  broadcast(state)
  return state
}

function updatePaused(id: string, paused: boolean): void {
  const profileId = profileForActiveItem(id)
  if (!profileId) return
  const store = storesFor(profileId).downloads
  const items = store.get('items')
  const idx = items.findIndex((item) => item.id === id)
  if (idx === -1) return
  const next = [...items]
  next[idx] = { ...next[idx], paused }
  store.set('items', next)
}

/** Remember which profile owns each active download for pause/resume. */
const activeDownloadProfiles = new Map<string, string>()

function profileForActiveItem(id: string): string | undefined {
  return activeDownloadProfiles.get(id)
}

export function pauseDownload(id: string): boolean {
  const item = activeItems.get(id)
  if (!item || item.isPaused() || item.getState() !== 'progressing') return false
  item.pause()
  updatePaused(id, true)
  return true
}

export function resumeDownload(id: string): boolean {
  const item = activeItems.get(id)
  if (!item || !item.isPaused() || !item.canResume()) return false
  item.resume()
  updatePaused(id, false)
  return true
}

export function cancelDownload(id: string): boolean {
  const item = activeItems.get(id)
  if (!item) return false
  item.cancel()
  return true
}

export function removeDownload(profileId: string, id: string): boolean {
  const item = activeItems.get(id)
  if (item) item.cancel()
  activeItems.delete(id)
  activeDownloadProfiles.delete(id)
  const store = storesFor(profileId).downloads
  const items = store.get('items')
  store.set(
    'items',
    items.filter((entry) => entry.id !== id)
  )
  return true
}

export function downloadUrl(profileId: string, id: string): string | undefined {
  return storesFor(profileId)
    .downloads.get('items')
    .find((entry) => entry.id === id)?.url
}

export function downloadPath(profileId: string, id: string): string | undefined {
  return storesFor(profileId)
    .downloads.get('items')
    .find((entry) => entry.id === id)?.path
}

export function openDownloadFolder(profileId: string, id: string): boolean {
  const path = downloadPath(profileId, id)
  if (!path) return false
  shell.showItemInFolder(path)
  return true
}

function openWhenDone(profileId: string, item: ElectronDownloadItem): void {
  if (getSettings(profileId, 'openDownloadsWhenDone', false) !== true) return
  const path = item.getSavePath()
  if (path) void shell.openPath(path)
}

export function attachDownloadsTracking(
  session: Session,
  profileId: string,
  broadcast: (state: DownloadsState) => void,
  options: { persist?: boolean } = {}
): void {
  if (trackedSessions.has(session)) return
  trackedSessions.add(session)
  if (options.persist === false) {
    // Incognito downloads keep Electron's default save behavior but are
    // never written to the downloads history or broadcast to the UI.
    return
  }

  session.on('will-download', (_event, item) => {
    const id = randomUUID()
    const download: DownloadItem = {
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: 'progressing',
      paused: false,
      startTime: Date.now()
    }
    activeItems.set(id, item)
    activeDownloadProfiles.set(id, profileId)
    upsertDownload(profileId, download)
    broadcast(currentDownloadsState(profileId))

    item.on('updated', () => {
      upsertDownload(profileId, {
        id,
        url: item.getURL(),
        filename: item.getFilename(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: 'progressing',
        paused: item.isPaused(),
        startTime: download.startTime,
        endTime: undefined,
        path: item.getSavePath() || undefined
      })
      broadcast(currentDownloadsState(profileId))
    })

    item.on('done', (_doneEvent, state) => {
      activeItems.delete(id)
      activeDownloadProfiles.delete(id)
      upsertDownload(profileId, {
        id,
        url: item.getURL(),
        filename: item.getFilename(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state:
          state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted',
        paused: false,
        startTime: download.startTime,
        endTime: Date.now(),
        path: item.getSavePath() || undefined
      })
      broadcast(currentDownloadsState(profileId))
      if (state === 'completed') openWhenDone(profileId, item)
    })
  })
}
