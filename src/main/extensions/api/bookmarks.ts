import type { BookmarksState } from '../../../shared/types'
import {
  addBookmark,
  addFolder,
  currentBookmarksState,
  moveBookmarkNode,
  removeBookmark,
  removeFolder,
  updateBookmark,
  updateFolder
} from '../../bookmarks/bookmarks'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

type NodeKind = 'bookmark' | 'folder'
interface ChromeNode {
  id: string
  title: string
  url?: string
  dateAdded: number
  dateLastModified?: number
  parentId?: string
  index: number
  children?: ChromeNode[]
}

const ROOTS = ['0', '1', '2']
const noBroadcast = (): void => {}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const encodeId = (kind: NodeKind, id: string): string => `${kind === 'folder' ? 'f' : 'b'}:${id}`

const decodeId = (value: unknown): { kind: NodeKind; id: string } | null => {
  if (typeof value !== 'string') return null
  if (value.startsWith('f:')) return { kind: 'folder', id: value.slice(2) }
  if (value.startsWith('b:')) return { kind: 'bookmark', id: value.slice(2) }
  if (ROOTS.includes(value)) return { kind: 'folder', id: '__root__' }
  return null
}

const parentChromeId = (parentId: string | null): string =>
  parentId === null ? '0' : encodeId('folder', parentId)

function childrenOf(state: BookmarksState, parentId: string | null): ChromeNode[] {
  const folders = state.folders
    .filter((folder) => folder.parentId === parentId)
    .map((folder, index) => ({
      id: encodeId('folder', folder.id),
      title: folder.title,
      dateAdded: folder.createdAt,
      parentId: parentChromeId(parentId),
      index,
      children: childrenOf(state, folder.id)
    }))
  const items = state.items
    .filter((item) => (item.folderId ?? null) === parentId)
    .map((item, index) => ({
      id: encodeId('bookmark', item.id),
      title: item.title,
      url: item.url,
      dateAdded: item.createdAt,
      parentId: parentChromeId(parentId),
      index
    }))
  return [...folders, ...items]
}

function rootNode(state: BookmarksState, id: string, title: string): ChromeNode {
  const children = id === '0' ? childrenOf(state, null) : []
  return {
    id,
    title,
    dateAdded: 0,
    index: ROOTS.indexOf(id),
    children
  }
}

function allNodes(state: BookmarksState): ChromeNode[] {
  const flatten = (node: ChromeNode): ChromeNode[] => [
    node,
    ...(node.children ?? []).flatMap(flatten)
  ]
  return ROOTS.flatMap((id, index) =>
    flatten(
      rootNode(
        state,
        id,
        ['Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'][index] ?? `Root ${id}`
      )
    )
  )
}

function findNode(state: BookmarksState, chromeId: string): ChromeNode | null {
  return allNodes(state).find((node) => node.id === chromeId) ?? null
}

function internalFolderId(profileId: string, chromeId: unknown): string | null {
  if (chromeId === undefined || chromeId === null || chromeId === '0' || chromeId === '__root__') {
    return null
  }
  const decoded = decodeId(chromeId)
  if (!decoded || decoded.kind !== 'folder') throw new Error('Invalid bookmark folder id')
  if (!currentBookmarksState(profileId).folders.some((folder) => folder.id === decoded.id)) {
    throw new Error('Bookmark folder not found')
  }
  return decoded.id
}

function emit(profileId: string, event: string, args: unknown[]): void {
  broadcastExtensionApiEvent(profileId, { path: ['bookmarks'], event, args }, 'bookmarks')
}

function changesBeforeAfter(
  before: ChromeNode | null,
  after: ChromeNode | null
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  if (before?.title !== after?.title && after) changes.title = after.title
  if (before?.url !== after?.url && after) changes.url = after.url
  return changes
}

export function registerBookmarks(): void {
  registerExtensionApiHandler('bookmarks', {
    permissions: ['bookmarks'],
    invoke(context, method, args): unknown {
      const profileId = context.profileId
      const state = (): BookmarksState => currentBookmarksState(profileId)
      const options = record(args[0])

      if (method === 'getTree') {
        return ROOTS.map((id, index) =>
          rootNode(
            state(),
            id,
            ['Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'][index] ?? `Root ${id}`
          )
        )
      }
      if (method === 'get') {
        const node = findNode(state(), String(args[0] ?? ''))
        if (!node) throw new Error('Bookmark node not found')
        return node
      }
      if (method === 'getChildren') {
        const node = findNode(state(), String(args[0] ?? ''))
        return node?.children ?? []
      }
      if (method === 'getRecent') {
        const count = typeof args[0] === 'number' ? Math.max(0, args[0]) : 100
        return state()
          .items.slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, count)
          .map((item, index) => ({
            id: encodeId('bookmark', item.id),
            title: item.title,
            url: item.url,
            dateAdded: item.createdAt,
            index
          }))
      }
      if (method === 'search') {
        const query = String(args[0] ?? '').toLowerCase()
        return allNodes(state()).filter(
          (node) =>
            node.id.startsWith('b:') &&
            (node.title.toLowerCase().includes(query) ||
              (node.url ?? '').toLowerCase().includes(query))
        )
      }
      if (method === 'create') {
        const parentId = internalFolderId(profileId, options.parentId ?? '0')
        const title = typeof options.title === 'string' ? options.title : ''
        const url = typeof options.url === 'string' ? options.url : undefined
        let node: ChromeNode
        if (url) {
          addBookmark(profileId, { title, url, folderId: parentId }, noBroadcast)
          const created = state().items.find(
            (item) => item.url === url && (item.folderId ?? null) === parentId
          )
          if (!created) throw new Error('Could not create bookmark')
          node = findNode(state(), encodeId('bookmark', created.id))!
        } else {
          addFolder(profileId, { title: title || 'New Folder', parentId }, noBroadcast)
          const created = state().folders.find(
            (folder) => folder.title === (title || 'New Folder') && folder.parentId === parentId
          )
          if (!created) throw new Error('Could not create bookmark folder')
          node = findNode(state(), encodeId('folder', created.id))!
        }
        emit(profileId, 'onCreated', [node.id, node])
        return node
      }
      if (method === 'update') {
        const decoded = decodeId(args[0])
        if (!decoded) throw new Error('Invalid bookmark node id')
        const before = findNode(state(), String(args[0]))
        const patch = record(args[1])
        if (decoded.kind === 'bookmark') {
          const title = typeof patch.title === 'string' ? patch.title : undefined
          const url = typeof patch.url === 'string' ? patch.url : undefined
          if (!title && !url) throw new Error('No bookmark changes were provided')
          updateBookmark(profileId, decoded.id, { title, url }, noBroadcast)
        } else {
          if (typeof patch.title !== 'string') throw new Error('No folder changes were provided')
          updateFolder(profileId, decoded.id, { title: patch.title }, noBroadcast)
        }
        const after = findNode(state(), String(args[0]))
        const changes = changesBeforeAfter(before, after)
        emit(profileId, 'onUpdated', [String(args[0]), changes])
        return after
      }
      if (method === 'remove' || method === 'removeTree') {
        const decoded = decodeId(args[0])
        if (!decoded) throw new Error('Invalid bookmark node id')
        const removed = findNode(state(), String(args[0]))
        const parentId = removed?.parentId ?? '0'
        const index = removed?.index ?? 0
        if (decoded.kind === 'bookmark') removeBookmark(profileId, decoded.id, noBroadcast)
        else removeFolder(profileId, decoded.id, noBroadcast)
        emit(profileId, 'onRemoved', [
          String(args[0]),
          { parentId, index, node: removed ?? undefined }
        ])
        return undefined
      }
      if (method === 'move') {
        const decoded = decodeId(args[0])
        const destination = record(args[1])
        if (!decoded) throw new Error('Invalid bookmark node id')
        const before = findNode(state(), String(args[0]))
        const parentId = internalFolderId(profileId, destination.parentId ?? '0')
        const siblings = childrenOf(state(), parentId).filter((node) => node.id !== String(args[0]))
        const requestedIndex =
          typeof destination.index === 'number'
            ? Math.max(0, Math.min(destination.index, siblings.length))
            : siblings.length
        const beforeId = siblings[requestedIndex]?.id.startsWith('b:')
          ? siblings[requestedIndex].id.slice(2)
          : siblings[requestedIndex]?.id.startsWith('f:')
            ? siblings[requestedIndex].id.slice(2)
            : undefined
        moveBookmarkNode(
          profileId,
          {
            kind: decoded.kind,
            id: decoded.id,
            parentId,
            beforeId
          },
          noBroadcast
        )
        const after = findNode(state(), String(args[0]))
        emit(profileId, 'onMoved', [
          String(args[0]),
          {
            parentId: parentChromeId(parentId),
            index: after?.index ?? requestedIndex,
            oldParentId: before?.parentId ?? '0',
            oldIndex: before?.index ?? 0
          }
        ])
        return after
      }
      throw new Error(`chrome.bookmarks.${method} is not supported.`)
    }
  })
}
