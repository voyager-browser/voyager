import { randomUUID } from 'node:crypto'
import type {
  BookmarkClipboard,
  BookmarkFolder,
  BookmarkFolderPatch,
  BookmarkItem,
  BookmarkMoveInput,
  BookmarkNodeKind,
  BookmarkPatch,
  BookmarksState,
  NewBookmarkFolderInput,
  NewBookmarkInput
} from '../../shared/types'
import { getSettings, setSettings, storesFor } from '../store'

/**
 * Bookmarks live in the main process (persisted to userData) and are
 * broadcast to the chrome renderer whenever they change. Bookmarks and
 * folders form a shallow tree: each node points at a parent folder (or the
 * bar root via `null`). Duplicate URLs are allowed in different folders, but
 * the star/Add Page paths dedupe within their target folder.
 */

type Broadcast = (state: BookmarksState) => void

/** Internal clipboard is shared across profiles so bookmarks can be transferred. */
let bookmarkClipboard: BookmarkClipboard | null = null

function clipboardFor(_profileId: string): BookmarkClipboard | null {
  return bookmarkClipboard
}

function setClipboard(_profileId: string, clipboard: BookmarkClipboard | null): void {
  bookmarkClipboard = clipboard
}

function storedItems(profileId: string): BookmarkItem[] {
  return storesFor(profileId).bookmarks.get('items')
}

function storedFolders(profileId: string): BookmarkFolder[] {
  return storesFor(profileId).bookmarks.get('folders') ?? []
}

function normalizeItems(profileId: string): BookmarkItem[] {
  return storedItems(profileId).map((item) => ({ ...item, folderId: item.folderId ?? null }))
}

function folderExists(profileId: string, id: string | null): boolean {
  return id === null || storedFolders(profileId).some((folder) => folder.id === id)
}

/** All descendant folder ids of `id`, including `id` itself. */
function folderSubtree(profileId: string, id: string): Set<string> {
  const ids = new Set<string>([id])
  let changed = true
  const folders = storedFolders(profileId)
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        changed = true
      }
    }
  }
  return ids
}

function resolveBookmarksBarVisibility(profileId: string): boolean {
  const stored = getSettings(profileId, 'bookmarksBarVisible')
  if (stored === undefined) {
    const visible = storedItems(profileId).length > 0
    if (visible) setSettings(profileId, 'bookmarksBarVisible', true)
    return visible
  }
  return stored === true
}

export function currentBookmarksState(profileId: string): BookmarksState {
  return {
    items: normalizeItems(profileId),
    folders: storedFolders(profileId),
    barVisible: resolveBookmarksBarVisibility(profileId),
    clipboard: clipboardFor(profileId)
  }
}

function publish(profileId: string, broadcast: Broadcast): BookmarksState {
  const state = currentBookmarksState(profileId)
  broadcast(state)
  return state
}

function revealBarIfNeeded(
  profileId: string,
  added: boolean,
  setBarExtent?: (visible: boolean) => void
): void {
  if (added && !resolveBookmarksBarVisibility(profileId)) {
    setSettings(profileId, 'bookmarksBarVisible', true)
    setBarExtent?.(true)
  }
}

/**
 * Hide the bar once the last bookmark or folder is gone, so an empty bar never
 * lingers after the user removes their bookmarks.
 */
function hideBarIfEmpty(
  profileId: string,
  setBarExtent?: (visible: boolean) => void
): void {
  if (storedItems(profileId).length > 0 || storedFolders(profileId).length > 0) return
  if (getSettings(profileId, 'bookmarksBarVisible') === true) {
    setSettings(profileId, 'bookmarksBarVisible', false)
  }
  setBarExtent?.(false)
}

/** Add a bookmark (dedupes by URL within the target folder). */
export function addBookmark(
  profileId: string,
  input: NewBookmarkInput,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const folderId = input.folderId ?? null
  if (!folderExists(profileId, folderId)) throw new Error('Folder not found')

  const store = storesFor(profileId).bookmarks
  const items = storedItems(profileId)
  const existing = items.find(
    (item) => item.url === input.url && (item.folderId ?? null) === folderId
  )
  let added = false

  if (existing) {
    if (input.favicon) {
      store.update('items', (list) =>
        list.map((item) =>
          item.id === existing.id ? { ...item, favicon: input.favicon ?? item.favicon } : item
        )
      )
    }
  } else {
    store.update('items', (list) => [
      ...list,
      {
        id: randomUUID(),
        title: input.title.trim() || input.url,
        url: input.url,
        favicon: input.favicon ?? null,
        folderId,
        createdAt: Date.now()
      }
    ])
    added = true
  }

  revealBarIfNeeded(profileId, added, setBarExtent)
  return publish(profileId, broadcast)
}

export function removeBookmark(
  profileId: string,
  id: string,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  storesFor(profileId).bookmarks.update('items', (list) =>
    list.filter((item) => item.id !== id)
  )
  hideBarIfEmpty(profileId, setBarExtent)
  return publish(profileId, broadcast)
}

export function updateBookmark(
  profileId: string,
  id: string,
  patch: BookmarkPatch,
  broadcast: Broadcast
): BookmarksState {
  storesFor(profileId).bookmarks.update('items', (list) =>
    list.map((item) =>
      item.id === id
        ? {
            ...item,
            title: patch.title?.trim() ? patch.title.trim() : item.title,
            url: patch.url?.trim() ? patch.url.trim() : item.url
          }
        : item
    )
  )
  return publish(profileId, broadcast)
}

export function addFolder(
  profileId: string,
  input: NewBookmarkFolderInput,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const parentId = input.parentId ?? null
  if (!folderExists(profileId, parentId)) throw new Error('Parent folder not found')
  const folders = storedFolders(profileId)
  const id = randomUUID()
  const folder: BookmarkFolder = {
    id,
    title: input.title.trim() || 'New Folder',
    parentId,
    createdAt: Date.now()
  }
  storesFor(profileId).bookmarks.set('folders', [...folders, folder])
  revealBarIfNeeded(profileId, parentId === null, setBarExtent)
  return publish(profileId, broadcast)
}

export function updateFolder(
  profileId: string,
  id: string,
  patch: BookmarkFolderPatch,
  broadcast: Broadcast
): BookmarksState {
  storesFor(profileId).bookmarks.update('folders', (folders) =>
    (folders ?? []).map((folder) =>
      folder.id === id
        ? { ...folder, title: patch.title?.trim() ? patch.title.trim() : folder.title }
        : folder
    )
  )
  return publish(profileId, broadcast)
}

/** Remove a folder and everything inside it. */
export function removeFolder(
  profileId: string,
  id: string,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const store = storesFor(profileId).bookmarks
  const doomed = folderSubtree(profileId, id)
  store.set(
    'folders',
    storedFolders(profileId).filter((folder) => !doomed.has(folder.id))
  )
  store.set(
    'items',
    storedItems(profileId).filter((item) => !doomed.has(item.folderId ?? ''))
  )
  const clipboard = clipboardFor(profileId)
  if (clipboard) {
    // The clipboard contents may have been inside the removed subtree.
    const kindExists =
      clipboard.kind === 'folder'
        ? storedFolders(profileId).some((folder) => folder.id === clipboard.id)
        : storedItems(profileId).some((item) => item.id === clipboard.id)
    if (!kindExists) setClipboard(profileId, null)
  }
  hideBarIfEmpty(profileId, setBarExtent)
  return publish(profileId, broadcast)
}

/** Move a bookmark/folder, optionally before a sibling. */
export function moveBookmarkNode(
  profileId: string,
  input: BookmarkMoveInput,
  broadcast: Broadcast
): BookmarksState {
  const { kind, id, parentId, beforeId } = input
  if (!folderExists(profileId, parentId)) throw new Error('Folder not found')
  const store = storesFor(profileId).bookmarks

  if (kind === 'folder') {
    const folders = storedFolders(profileId)
    const folder = folders.find((candidate) => candidate.id === id)
    if (!folder) return publish(profileId, broadcast)
    if (parentId !== null && folderSubtree(profileId, id).has(parentId)) {
      if (parentId === id) return publish(profileId, broadcast)
      throw new Error('Cannot move a folder into itself')
    }
    const next = folders.filter((candidate) => candidate.id !== id)
    const moved = { ...folder, parentId }
    const index = beforeId ? next.findIndex((candidate) => candidate.id === beforeId) : -1
    if (index === -1) next.push(moved)
    else next.splice(index, 0, moved)
    store.set('folders', next)
  } else {
    const items = storedItems(profileId)
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return publish(profileId, broadcast)
    const next = items.filter((candidate) => candidate.id !== id)
    const moved = { ...item, folderId: parentId }
    const index = beforeId ? next.findIndex((candidate) => candidate.id === beforeId) : -1
    if (index === -1) next.push(moved)
    else next.splice(index, 0, moved)
    store.set('items', next)
  }

  return publish(profileId, broadcast)
}

export function copyBookmarkNode(
  profileId: string,
  kind: BookmarkNodeKind,
  id: string,
  broadcast: Broadcast
): BookmarksState {
  setClipboard(profileId, { mode: 'copy', kind, id })
  return publish(profileId, broadcast)
}

export function cutBookmarkNode(
  profileId: string,
  kind: BookmarkNodeKind,
  id: string,
  broadcast: Broadcast
): BookmarksState {
  setClipboard(profileId, { mode: 'cut', kind, id })
  return publish(profileId, broadcast)
}

function cloneFolder(profileId: string, folder: BookmarkFolder, parentId: string | null): string {
  const store = storesFor(profileId).bookmarks
  const newId = randomUUID()
  const clone: BookmarkFolder = {
    ...folder,
    id: newId,
    parentId,
    createdAt: Date.now()
  }
  store.update('folders', (folders) => [...(folders ?? []), clone])
  const children = storedFolders(profileId).filter(
    (candidate) => candidate.parentId === folder.id
  )
  for (const child of children) cloneFolder(profileId, child, newId)
  store.update('items', (items) => [
    ...items,
    ...storedItems(profileId)
      .filter((item) => (item.folderId ?? null) === folder.id)
      .map((item) => ({
        ...item,
        id: randomUUID(),
        folderId: newId,
        createdAt: Date.now()
      }))
  ])
  return newId
}

function cloneBookmark(
  profileId: string,
  item: BookmarkItem,
  folderId: string | null
): void {
  storesFor(profileId).bookmarks.update('items', (items) => [
    ...items,
    { ...item, id: randomUUID(), folderId, createdAt: Date.now() }
  ])
}

/** Paste the internal bookmark clipboard into a folder. */
export function pasteBookmarkNode(
  profileId: string,
  parentId: string | null,
  broadcast: Broadcast
): BookmarksState {
  const clipboard = clipboardFor(profileId)
  if (!clipboard) return publish(profileId, broadcast)
  if (!folderExists(profileId, parentId)) throw new Error('Folder not found')

  const { mode, kind, id } = clipboard
  if (kind === 'bookmark') {
    const item = storedItems(profileId).find((candidate) => candidate.id === id)
    if (!item) {
      setClipboard(profileId, null)
      return publish(profileId, broadcast)
    }
    if (mode === 'cut') {
      moveBookmarkNode(profileId, { kind, id, parentId }, broadcast)
      setClipboard(profileId, null)
      return publish(profileId, broadcast)
    }
    cloneBookmark(profileId, item, parentId)
  } else {
    const folder = storedFolders(profileId).find((candidate) => candidate.id === id)
    if (!folder) {
      setClipboard(profileId, null)
      return publish(profileId, broadcast)
    }
    if (mode === 'cut') {
      moveBookmarkNode(profileId, { kind, id, parentId }, broadcast)
      setClipboard(profileId, null)
      return publish(profileId, broadcast)
    }
    cloneFolder(profileId, folder, parentId)
  }

  setClipboard(profileId, null)
  return publish(profileId, broadcast)
}

export function clearBookmarks(
  profileId: string,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const store = storesFor(profileId).bookmarks
  store.set('items', [])
  store.set('folders', [])
  setClipboard(profileId, null)
  hideBarIfEmpty(profileId, setBarExtent)
  return publish(profileId, broadcast)
}

/** Flip bar visibility; persists it and adjusts the chrome height. */
export function toggleBookmarksBar(
  profileId: string,
  broadcast: Broadcast,
  setBarExtent: (visible: boolean) => void
): BookmarksState {
  const visible = !(getSettings(profileId, 'bookmarksBarVisible') ?? false)
  setSettings(profileId, 'bookmarksBarVisible', visible)
  setBarExtent(visible)
  return publish(profileId, broadcast)
}
