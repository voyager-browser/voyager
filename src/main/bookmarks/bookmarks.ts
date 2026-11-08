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
import { bookmarksStore, getSettings, setSettings } from '../store'

/**
 * Bookmarks live in the main process (persisted to userData) and are
 * broadcast to the chrome renderer whenever they change. Bookmarks and
 * folders form a shallow tree: each node points at a parent folder (or the
 * bar root via `null`). Duplicate URLs are allowed in different folders, but
 * the star/Add Page paths dedupe within their target folder.
 */

type Broadcast = (state: BookmarksState) => void

let bookmarkClipboard: BookmarkClipboard | null = null

function storedItems(): BookmarkItem[] {
  return bookmarksStore.get('items')
}

function storedFolders(): BookmarkFolder[] {
  return bookmarksStore.get('folders') ?? []
}
function normalizeItems(): BookmarkItem[] {
  return storedItems().map((item) => ({ ...item, folderId: item.folderId ?? null }))
}

function folderExists(id: string | null): boolean {
  return id === null || storedFolders().some((folder) => folder.id === id)
}

/** All descendant folder ids of `id`, including `id` itself. */
function folderSubtree(id: string): Set<string> {
  const ids = new Set<string>([id])
  let changed = true
  const folders = storedFolders()
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

function resolveBookmarksBarVisibility(): boolean {
  const stored = getSettings('bookmarksBarVisible')
  if (stored === undefined) {
    const visible = storedItems().length > 0
    if (visible) setSettings('bookmarksBarVisible', true)
    return visible
  }
  return stored === true
}

export function currentBookmarksState(): BookmarksState {
  return {
    items: normalizeItems(),
    folders: storedFolders(),
    barVisible: resolveBookmarksBarVisibility(),
    clipboard: bookmarkClipboard
  }
}

function publish(broadcast: Broadcast): BookmarksState {
  const state = currentBookmarksState()
  broadcast(state)
  return state
}

function revealBarIfNeeded(added: boolean, setBarExtent?: (visible: boolean) => void): void {
  if (added && !resolveBookmarksBarVisibility()) {
    setSettings('bookmarksBarVisible', true)
    setBarExtent?.(true)
  }
}

/**
 * Hide the bar once the last bookmark or folder is gone, so an empty bar never
 * lingers after the user removes their bookmarks.
 */
function hideBarIfEmpty(setBarExtent?: (visible: boolean) => void): void {
  if (storedItems().length > 0 || storedFolders().length > 0) return
  if (getSettings('bookmarksBarVisible') === true) {
    setSettings('bookmarksBarVisible', false)
  }
  setBarExtent?.(false)
}

/** Add a bookmark (dedupes by URL within the target folder). */
export function addBookmark(
  input: NewBookmarkInput,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const folderId = input.folderId ?? null
  if (!folderExists(folderId)) throw new Error('Folder not found')

  const items = storedItems()
  const existing = items.find(
    (item) => item.url === input.url && (item.folderId ?? null) === folderId
  )
  let added = false

  if (existing) {
    if (input.favicon) {
      bookmarksStore.update('items', (list) =>
        list.map((item) =>
          item.id === existing.id ? { ...item, favicon: input.favicon ?? item.favicon } : item
        )
      )
    }
  } else {
    bookmarksStore.update('items', (list) => [
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

  revealBarIfNeeded(added, setBarExtent)
  return publish(broadcast)
}

export function removeBookmark(
  id: string,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  bookmarksStore.update('items', (list) => list.filter((item) => item.id !== id))
  hideBarIfEmpty(setBarExtent)
  return publish(broadcast)
}

export function updateBookmark(
  id: string,
  patch: BookmarkPatch,
  broadcast: Broadcast
): BookmarksState {
  bookmarksStore.update('items', (list) =>
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
  return publish(broadcast)
}

export function addFolder(
  input: NewBookmarkFolderInput,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const parentId = input.parentId ?? null
  if (!folderExists(parentId)) throw new Error('Parent folder not found')
  const folders = storedFolders()
  const id = randomUUID()
  const folder: BookmarkFolder = {
    id,
    title: input.title.trim() || 'New Folder',
    parentId,
    createdAt: Date.now()
  }
  bookmarksStore.set('folders', [...folders, folder])
  revealBarIfNeeded(parentId === null, setBarExtent)
  return publish(broadcast)
}

export function updateFolder(
  id: string,
  patch: BookmarkFolderPatch,
  broadcast: Broadcast
): BookmarksState {
  bookmarksStore.update('folders', (folders) =>
    (folders ?? []).map((folder) =>
      folder.id === id
        ? { ...folder, title: patch.title?.trim() ? patch.title.trim() : folder.title }
        : folder
    )
  )
  return publish(broadcast)
}

/** Remove a folder and everything inside it. */
export function removeFolder(
  id: string,
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  const doomed = folderSubtree(id)
  bookmarksStore.set(
    'folders',
    storedFolders().filter((folder) => !doomed.has(folder.id))
  )
  bookmarksStore.set(
    'items',
    storedItems().filter((item) => !doomed.has(item.folderId ?? ''))
  )
  if (bookmarkClipboard) {
    // The clipboard contents may have been inside the removed subtree.
    const kindExists =
      bookmarkClipboard.kind === 'folder'
        ? storedFolders().some((folder) => folder.id === bookmarkClipboard?.id)
        : storedItems().some((item) => item.id === bookmarkClipboard?.id)
    if (!kindExists) bookmarkClipboard = null
  }
  hideBarIfEmpty(setBarExtent)
  return publish(broadcast)
}

/** Move a bookmark/folder, optionally before a sibling. */
export function moveBookmarkNode(input: BookmarkMoveInput, broadcast: Broadcast): BookmarksState {
  const { kind, id, parentId, beforeId } = input
  if (!folderExists(parentId)) throw new Error('Folder not found')

  if (kind === 'folder') {
    const folders = storedFolders()
    const folder = folders.find((candidate) => candidate.id === id)
    if (!folder) return publish(broadcast)
    if (parentId !== null && folderSubtree(id).has(parentId)) {
      if (parentId === id) return publish(broadcast)
      throw new Error('Cannot move a folder into itself')
    }
    const next = folders.filter((candidate) => candidate.id !== id)
    const moved = { ...folder, parentId }
    const index = beforeId ? next.findIndex((candidate) => candidate.id === beforeId) : -1
    if (index === -1) next.push(moved)
    else next.splice(index, 0, moved)
    bookmarksStore.set('folders', next)
  } else {
    const items = storedItems()
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return publish(broadcast)
    const next = items.filter((candidate) => candidate.id !== id)
    const moved = { ...item, folderId: parentId }
    const index = beforeId ? next.findIndex((candidate) => candidate.id === beforeId) : -1
    if (index === -1) next.push(moved)
    else next.splice(index, 0, moved)
    bookmarksStore.set('items', next)
  }

  return publish(broadcast)
}

export function copyBookmarkNode(
  kind: BookmarkNodeKind,
  id: string,
  broadcast: Broadcast
): BookmarksState {
  bookmarkClipboard = { mode: 'copy', kind, id }
  return publish(broadcast)
}

export function cutBookmarkNode(
  kind: BookmarkNodeKind,
  id: string,
  broadcast: Broadcast
): BookmarksState {
  bookmarkClipboard = { mode: 'cut', kind, id }
  return publish(broadcast)
}

function cloneFolder(folder: BookmarkFolder, parentId: string | null): string {
  const newId = randomUUID()
  const clone: BookmarkFolder = {
    ...folder,
    id: newId,
    parentId,
    createdAt: Date.now()
  }
  bookmarksStore.update('folders', (folders) => [...(folders ?? []), clone])
  const children = storedFolders().filter((candidate) => candidate.parentId === folder.id)
  for (const child of children) cloneFolder(child, newId)
  bookmarksStore.update('items', (items) => [
    ...items,
    ...storedItems()
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

function cloneBookmark(item: BookmarkItem, folderId: string | null): void {
  bookmarksStore.update('items', (items) => [
    ...items,
    { ...item, id: randomUUID(), folderId, createdAt: Date.now() }
  ])
}

/** Paste the internal bookmark clipboard into a folder. */
export function pasteBookmarkNode(parentId: string | null, broadcast: Broadcast): BookmarksState {
  if (!bookmarkClipboard) return publish(broadcast)
  if (!folderExists(parentId)) throw new Error('Folder not found')

  const { mode, kind, id } = bookmarkClipboard
  if (kind === 'bookmark') {
    const item = storedItems().find((candidate) => candidate.id === id)
    if (!item) {
      bookmarkClipboard = null
      return publish(broadcast)
    }
    if (mode === 'cut') {
      moveBookmarkNode({ kind, id, parentId }, broadcast)
      bookmarkClipboard = null
      return publish(broadcast)
    }
    cloneBookmark(item, parentId)
  } else {
    const folder = storedFolders().find((candidate) => candidate.id === id)
    if (!folder) {
      bookmarkClipboard = null
      return publish(broadcast)
    }
    if (mode === 'cut') {
      moveBookmarkNode({ kind, id, parentId }, broadcast)
      bookmarkClipboard = null
      return publish(broadcast)
    }
    cloneFolder(folder, parentId)
  }

  bookmarkClipboard = null
  return publish(broadcast)
}

export function clearBookmarks(
  broadcast: Broadcast,
  setBarExtent?: (visible: boolean) => void
): BookmarksState {
  bookmarksStore.set('items', [])
  bookmarksStore.set('folders', [])
  bookmarkClipboard = null
  hideBarIfEmpty(setBarExtent)
  return publish(broadcast)
}

/** Flip bar visibility; persists it and adjusts the chrome height. */
export function toggleBookmarksBar(
  broadcast: Broadcast,
  setBarExtent: (visible: boolean) => void
): BookmarksState {
  const visible = !(getSettings('bookmarksBarVisible') ?? false)
  setSettings('bookmarksBarVisible', visible)
  setBarExtent(visible)
  return publish(broadcast)
}
