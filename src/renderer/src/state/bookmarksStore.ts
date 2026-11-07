import { create } from 'zustand'
import type {
  BookmarkFolderPatch,
  BookmarkMoveInput,
  BookmarkNodeKind,
  BookmarkPatch,
  BookmarksState,
  NewBookmarkFolderInput
} from '../../../shared/types'
import { isNewTab } from '../../../shared/url'
import { useBrowserStore } from './browserStore'

interface BookmarksStore extends BookmarksState {
  applyState: (state: BookmarksState) => void
  addBookmark: (
    title: string,
    url: string,
    favicon?: string | null,
    folderId?: string | null
  ) => void
  bookmarkActivePage: () => void
  removeBookmark: (id: string) => void
  updateBookmark: (id: string, patch: BookmarkPatch) => void
  addFolder: (title: string, parentId?: string | null) => void
  updateFolder: (id: string, patch: BookmarkFolderPatch) => void
  removeFolder: (id: string) => void
  move: (input: BookmarkMoveInput) => void
  cut: (kind: BookmarkNodeKind, id: string) => void
  copy: (kind: BookmarkNodeKind, id: string) => void
  paste: (parentId: string | null) => void
  toggleBar: () => void
}

function apply(promise: Promise<BookmarksState>): void {
  void promise.then(useBookmarksStore.getState().applyState)
}

export const useBookmarksStore = create<BookmarksStore>()((set, get) => ({
  items: [],
  folders: [],
  barVisible: false,
  clipboard: null,

  applyState: (state) =>
    set({
      items: state.items,
      folders: state.folders ?? [],
      barVisible: state.barVisible,
      clipboard: state.clipboard ?? null
    }),

  addBookmark: (title, url, favicon, folderId) => {
    apply(window.voyager.bookmarks.add({ title, url, favicon, folderId }))
  },
  bookmarkActivePage: () => {
    const browser = useBrowserStore.getState()
    const tab = browser.tabs.find((candidate) => candidate.id === browser.activeTabId)
    if (!tab || isNewTab(tab.url)) return
    const existing = get().items.find(
      (item) => item.url === tab.url && (item.folderId ?? null) === null
    )
    if (existing) {
      apply(window.voyager.bookmarks.remove(existing.id))
      return
    }
    apply(window.voyager.bookmarks.add({ title: tab.title || tab.url, url: tab.url, favicon: tab.favicon }))
  },
  removeBookmark: (id) => {
    apply(window.voyager.bookmarks.remove(id))
  },
  updateBookmark: (id, patch) => {
    apply(window.voyager.bookmarks.update(id, patch))
  },
  addFolder: (title, parentId = null) => {
    const input: NewBookmarkFolderInput = { title, parentId }
    apply(window.voyager.bookmarks.addFolder(input))
  },
  updateFolder: (id, patch) => {
    apply(window.voyager.bookmarks.updateFolder(id, patch))
  },
  removeFolder: (id) => {
    apply(window.voyager.bookmarks.removeFolder(id))
  },
  move: (input) => {
    apply(window.voyager.bookmarks.move(input))
  },
  cut: (kind, id) => {
    apply(window.voyager.bookmarks.cut(kind, id))
  },
  copy: (kind, id) => {
    apply(window.voyager.bookmarks.copy(kind, id))
  },
  paste: (parentId) => {
    apply(window.voyager.bookmarks.paste(parentId))
  },
  toggleBar: () => {
    apply(window.voyager.bookmarks.toggleBar())
  }
}))

/** Whether the given URL is already bookmarked. */
export function useIsBookmarked(url: string): boolean {
  return useBookmarksStore((state) => state.items.some((item) => item.url === url))
}

/** Direct children of a folder, or of the bar root when `folderId` is null. */
export function useBookmarkChildren(folderId: string | null): {
  folders: BookmarksState['folders']
  items: BookmarksState['items']
} {
  const folders = useBookmarksStore((state) => state.folders)
  const items = useBookmarksStore((state) => state.items)
  return {
    folders: folders.filter((folder) => folder.parentId === folderId),
    items: items.filter((item) => (item.folderId ?? null) === folderId)
  }
}
