import { shell, type DownloadItem as ElectronDownloadItem, type Session } from 'electron'
import type { DownloadItem } from '../../../shared/types'
import {
  cancelDownload,
  currentDownloadsState,
  pauseDownload,
  removeDownload,
  resumeDownload
} from '../../downloads/downloads'
import { sessionForProfile } from '../../profiles/session'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'

const attached = new WeakSet<Session>()
const pending = new Map<string, { profileId: string; id: number; url: string }>()
const itemIds = new WeakMap<ElectronDownloadItem, number>()

type IdMap = Record<string, number>

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const idKey = (profileId: string): string => `downloads:ids:${profileId}`

function idMap(profileId: string): IdMap {
  const stored = getApiSetting<IdMap>(profileId, idKey(profileId), {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
}

function numericId(profileId: string, internalId: string, allocate = false): number | undefined {
  const map = idMap(profileId)
  if (typeof map[internalId] === 'number') return map[internalId]
  if (!allocate) return undefined
  const next = Math.max(0, ...Object.values(map)) + 1
  map[internalId] = next
  setApiSetting(profileId, idKey(profileId), map)
  return next
}

function internalIdFor(profileId: string, id: number): string | undefined {
  return Object.entries(idMap(profileId)).find(([, value]) => value === id)?.[0]
}

/** Electron has no stable download id, so correlate with the app's tracked item. */
function assignItemId(profileId: string, item: ElectronDownloadItem, preferred?: number): number {
  const cached = itemIds.get(item)
  if (cached !== undefined) return cached
  const internal = currentDownloadsState(profileId).items.find(
    (candidate) => candidate.url === item.getURL()
  )
  let id: number
  if (typeof preferred === 'number') {
    id = preferred
    if (internal) {
      const map = idMap(profileId)
      map[internal.id] = id
      setApiSetting(profileId, idKey(profileId), map)
    }
  } else if (internal) {
    id = numericId(profileId, internal.id, true) ?? 0
  } else {
    id = Math.max(0, ...Object.values(idMap(profileId))) + 1
  }
  itemIds.set(item, id)
  return id
}

function chromeState(state: DownloadItem['state']): string {
  if (state === 'completed') return 'complete'
  if (state === 'progressing') return 'in_progress'
  return 'interrupted'
}

function publicItem(profileId: string, item: DownloadItem): Record<string, unknown> {
  const extensionId = numericId(profileId, item.id, true) ?? 0
  return {
    id: extensionId,
    url: item.url,
    filename: item.filename,
    bytesReceived: item.receivedBytes,
    totalBytes: item.totalBytes,
    state: chromeState(item.state),
    paused: item.paused === true,
    startTime: item.startTime,
    ...(item.endTime === undefined ? {} : { endTime: item.endTime }),
    ...(item.path ? { filePath: item.path } : {}),
    incognito: false,
    byExtensionId: ''
  }
}

function emit(
  profileId: string,
  event: string,
  item: DownloadItem | Record<string, unknown>
): void {
  broadcastExtensionApiEvent(profileId, { path: ['downloads'], event, args: [item] }, 'downloads')
}

/** Mirror Electron download lifecycle into chrome.downloads events. */
export function attachDownloadEvents(ses: Session, profileId: string): void {
  if (attached.has(ses)) return
  attached.add(ses)

  ses.on('will-download', (_event, item: ElectronDownloadItem) => {
    const url = item.getURL()
    const match = [...pending.entries()].find(
      ([, value]) => value.profileId === profileId && value.url === url
    )
    const id = assignItemId(profileId, item, match?.[1].id)
    if (match) pending.delete(match[0])
    const initial: Record<string, unknown> = {
      id,
      url,
      filename: item.getFilename(),
      bytesReceived: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: 'in_progress',
      paused: item.isPaused(),
      startTime: Date.now(),
      incognito: false
    }
    emit(profileId, 'onCreated', initial)
    item.on('updated', () => {
      emit(profileId, 'onChanged', {
        ...initial,
        bytesReceived: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        paused: item.isPaused()
      })
    })
    item.once('done', (_event, state) => {
      const complete = state === 'completed'
      emit(profileId, 'onChanged', {
        ...initial,
        bytesReceived: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: complete ? 'complete' : 'interrupted',
        paused: false,
        endTime: Date.now(),
        ...(complete ? { filePath: item.getSavePath() } : {})
      })
    })
  })
}

export function registerDownloads(): void {
  registerExtensionApiHandler('downloads', {
    permissions: ['downloads'],
    invoke(context, method, args): unknown {
      const profileId = context.profileId
      const state = currentDownloadsState(profileId)

      if (method === 'download') {
        const url = typeof args[0] === 'string' ? args[0] : ''
        if (!url) throw new Error('A download URL is required')
        const id = Math.max(0, ...Object.values(idMap(profileId))) + 1
        pending.set(`${Date.now()}-${id}`, { profileId, id, url })
        void sessionForProfile(profileId).downloadURL(url)
        return id
      }
      if (method === 'search') {
        const query = record(args[0])
        let items = state.items
        if (typeof query.id === 'number') {
          const internal = internalIdFor(profileId, query.id)
          items = items.filter((item) => item.id === internal)
        }
        if (typeof query.url === 'string' && query.url.length > 0) {
          items = items.filter((item) => item.url === query.url)
        }
        const filenameRegex =
          typeof query.filename === 'string' && query.filename.length > 0
            ? new RegExp(query.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            : null
        if (filenameRegex) items = items.filter((item) => filenameRegex.test(item.filename))
        return items.map((item) => publicItem(profileId, item))
      }
      if (method === 'getFileIcon') {
        return ''
      }
      const id = typeof args[0] === 'number' ? args[0] : -1
      const internal = internalIdFor(profileId, id)
      if (!internal) return false

      if (method === 'open') {
        const item = state.items.find((candidate) => candidate.id === internal)
        if (!item?.path) return false
        void shell.openPath(item.path!)
        return true
      }
      if (method === 'show') {
        const item = state.items.find((candidate) => candidate.id === internal)
        if (!item?.path) return false
        shell.showItemInFolder(item.path!)
        return true
      }
      if (method === 'pause') return pauseDownload(internal)
      if (method === 'resume') return resumeDownload(internal)
      if (method === 'canPause') {
        const item = state.items.find((candidate) => candidate.id === internal)
        return item?.state === 'progressing' && item.paused !== true
      }
      if (method === 'canResume') {
        const item = state.items.find((candidate) => candidate.id === internal)
        return item?.state === 'progressing' && item.paused === true
      }
      if (method === 'cancel') return cancelDownload(internal)
      if (method === 'removeFile' || method === 'erase') {
        removeDownload(profileId, internal)
        const item = state.items.find((candidate) => candidate.id === internal)
        if (item) emit(profileId, 'onErased', publicItem(profileId, item))
        const map = idMap(profileId)
        delete map[internal]
        setApiSetting(profileId, idKey(profileId), map)
        return undefined
      }
      throw new Error(`chrome.downloads.${method} is not supported.`)
    }
  })
}
