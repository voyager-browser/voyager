import { useState } from 'react'
import { Folder } from 'lucide-react'
import { isNewTab } from '../../../shared/url'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useActiveTab, useBrowserStore } from '../state/browserStore'
import { useUiStore } from '../state/uiStore'
import { BookmarkDialog } from './BookmarkDialog'
import { ContextMenu, type ContextMenuItem } from './ui/ContextMenu'

interface MenuState {
  x: number
  y: number
  kind: 'root' | 'bookmark' | 'folder'
  id?: string
}

interface FolderMenuState {
  x: number
  y: number
  folderId: string
}

type DialogState =
  | { kind: 'add-folder'; parentId: string | null }
  | { kind: 'edit-folder'; id: string; title: string }
  | { kind: 'edit-bookmark'; id: string; title: string; url: string }

const INTERNAL_DRAG_TYPE = 'application/x-voyager-bookmark'

function hasInternalDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(INTERNAL_DRAG_TYPE)
}

/** Horizontal strip of bookmark shortcuts shown below the toolbar. */
export function BookmarksBar(): React.JSX.Element | null {
  const folders = useBookmarksStore((state) => state.folders)
  const items = useBookmarksStore((state) => state.items)
  const clipboard = useBookmarksStore((state) => state.clipboard)
  const barVisible = useBookmarksStore((state) => state.barVisible)
  const navigate = useBrowserStore((state) => state.navigate)
  const activeTab = useActiveTab()
  const openManager = useUiStore((state) => state.openBookmarksManager)

  const addBookmark = useBookmarksStore((state) => state.addBookmark)
  const removeBookmark = useBookmarksStore((state) => state.removeBookmark)
  const updateBookmark = useBookmarksStore((state) => state.updateBookmark)
  const addFolder = useBookmarksStore((state) => state.addFolder)
  const updateFolder = useBookmarksStore((state) => state.updateFolder)
  const removeFolder = useBookmarksStore((state) => state.removeFolder)
  const move = useBookmarksStore((state) => state.move)
  const cut = useBookmarksStore((state) => state.cut)
  const copy = useBookmarksStore((state) => state.copy)
  const paste = useBookmarksStore((state) => state.paste)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const rootFolders = folders.filter((folder) => folder.parentId === null)
  const rootItems = items.filter((item) => (item.folderId ?? null) === null)

  if (!barVisible) return null

  const openMenu = (event: React.MouseEvent, kind: MenuState['kind'], id?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, kind, id })
  }

  const folderMenuItems = (folderId: string): ContextMenuItem[] => {
    const childFolders = folders.filter((folder) => folder.parentId === folderId)
    const childItems = items.filter((item) => (item.folderId ?? null) === folderId)
    if (childFolders.length === 0 && childItems.length === 0) {
      return [{ label: 'Empty', disabled: true }]
    }
    return [
      ...childFolders.map((folder) => ({
        label: folder.title,
        children: folderMenuItems(folder.id)
      })),
      ...childItems.map((item) => ({
        label: item.title,
        onSelect: () => navigate(item.url)
      }))
    ]
  }

  const rootMenuItems = (): ContextMenuItem[] => [
    {
      label: 'Add Page',
      disabled: activeTab === undefined || isNewTab(activeTab.url),
      onSelect: () => {
        if (activeTab) addBookmark(activeTab.title || activeTab.url, activeTab.url, activeTab.favicon)
      }
    },
    { label: 'Add Folder…', onSelect: () => setDialog({ kind: 'add-folder', parentId: null }) },
    { label: 'Open Bookmarks Manager', onSelect: openManager },
    { separator: true },
    { label: 'Paste', disabled: clipboard === null, onSelect: () => paste(null) }
  ]

  const bookmarkMenuItems = (id: string): ContextMenuItem[] => {
    const bookmark = items.find((item) => item.id === id)
    if (!bookmark) return []
    return [
      {
        label: 'Open in New Tab',
        onSelect: () => {
          void window.voyager.tabs.create({ url: bookmark.url, active: true })
        }
      },
      {
        label: 'Open in New Window',
        onSelect: () => {
          void window.voyager.bookmarks.openInNewWindow(bookmark.url)
        }
      },
      { separator: true },
      {
        label: 'Edit…',
        onSelect: () =>
          setDialog({
            kind: 'edit-bookmark',
            id: bookmark.id,
            title: bookmark.title,
            url: bookmark.url
          })
      },
      { separator: true },
      { label: 'Cut', onSelect: () => cut('bookmark', bookmark.id) },
      { label: 'Copy', onSelect: () => copy('bookmark', bookmark.id) },
      {
        label: 'Paste',
        disabled: clipboard === null,
        onSelect: () => paste(bookmark.folderId ?? null)
      },
      { separator: true },
      { label: 'Delete', danger: true, onSelect: () => removeBookmark(bookmark.id) }
    ]
  }

  const folderContextItems = (id: string): ContextMenuItem[] => {
    const folder = folders.find((candidate) => candidate.id === id)
    if (!folder) return []
    return [
      {
        label: 'Open All in New Tabs',
        disabled:
          items.every((item) => (item.folderId ?? null) !== folder.id) &&
          folders.every((child) => child.parentId !== folder.id),
        onSelect: () => {
          const direct = items.filter((item) => (item.folderId ?? null) === folder.id)
          for (const item of direct) {
            void window.voyager.tabs.create({ url: item.url, active: false })
          }
        }
      },
      { separator: true },
      {
        label: 'Edit…',
        onSelect: () => setDialog({ kind: 'edit-folder', id: folder.id, title: folder.title })
      },
      { separator: true },
      { label: 'Cut', onSelect: () => cut('folder', folder.id) },
      { label: 'Copy', onSelect: () => copy('folder', folder.id) },
      { label: 'Paste', disabled: clipboard === null, onSelect: () => paste(folder.id) },
      { separator: true },
      { label: 'Delete', danger: true, onSelect: () => removeFolder(folder.id) }
    ]
  }

  const handleDrop = async (
    event: React.DragEvent,
    parentId: string | null,
    beforeId: string | null = null
  ): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)

    const internal = event.dataTransfer.getData(INTERNAL_DRAG_TYPE)
    if (internal) {
      try {
        const payload = JSON.parse(internal) as { kind: 'bookmark' | 'folder'; id: string }
        move({ kind: payload.kind, id: payload.id, parentId, beforeId })
      } catch {
        // Ignore malformed drag payloads.
      }
      return
    }

    const raw =
      event.dataTransfer.getData('text/uri-list') ||
      event.dataTransfer.getData('text/plain') ||
      (await window.voyager.bookmarks.consumeDragUrl()) ||
      ''
    const url = raw.split('\n')[0]?.trim()
    if (!url) return
    addBookmark(url, url, null, parentId)
  }

  const barDropProps = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      setDragOver(true)
      event.dataTransfer.dropEffect = hasInternalDrag(event.dataTransfer) ? 'move' : 'copy'
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDragOver(false)
    },
    onDrop: (event: React.DragEvent) => void handleDrop(event, null)
  }

  return (
    <nav
      aria-label="Bookmarks bar"
      className="no-drag relative flex h-[30px] shrink-0 items-center gap-0.5 border-b border-border bg-bg px-1.5"
      onContextMenu={(event) => openMenu(event, 'root')}
      {...barDropProps}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {rootFolders.map((folder) => (
          <div
            key={folder.id}
            className="relative flex max-w-[180px] shrink-0"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                INTERNAL_DRAG_TYPE,
                JSON.stringify({ kind: 'folder', id: folder.id })
              )
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = hasInternalDrag(event.dataTransfer) ? 'move' : 'copy'
            }}
            onDrop={(event) => void handleDrop(event, folder.id)}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey) openMenu(event, 'folder', folder.id)
            }}
            onContextMenu={(event) => openMenu(event, 'folder', folder.id)}
          >
            <button
              type="button"
              title={folder.title}
              aria-label={`Folder ${folder.title}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setFolderMenu({ x: rect.left, y: rect.bottom + 2, folderId: folder.id })
              }}
              className="flex h-[22px] max-w-full items-center gap-1.5 rounded-md px-2 text-[12px] text-fg transition-colors hover:bg-hover"
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate">{folder.title}</span>
            </button>
          </div>
        ))}
        {rootItems.map((bookmark) => (
          <div
            key={bookmark.id}
            className="relative flex max-w-[180px] shrink-0"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                INTERNAL_DRAG_TYPE,
                JSON.stringify({ kind: 'bookmark', id: bookmark.id })
              )
              event.dataTransfer.setData('text/uri-list', bookmark.url)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = hasInternalDrag(event.dataTransfer) ? 'move' : 'copy'
            }}
            onDrop={(event) => void handleDrop(event, null, bookmark.id)}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey) openMenu(event, 'bookmark', bookmark.id)
            }}
            onContextMenu={(event) => openMenu(event, 'bookmark', bookmark.id)}
          >
            <button
              type="button"
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  openMenu(event, 'bookmark', bookmark.id)
                  return
                }
                navigate(bookmark.url)
              }}
              onContextMenu={(event) => openMenu(event, 'bookmark', bookmark.id)}
              title={bookmark.url}
              className="flex h-[22px] max-w-full items-center gap-1.5 rounded-md px-2 text-[12px] text-fg transition-colors hover:bg-hover"
            >
              {bookmark.favicon ? (
                <img src={bookmark.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
              ) : null}
              <span className="truncate">{bookmark.title}</span>
            </button>
          </div>
        ))}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm border-2 border-dashed border-accent bg-accent/10 text-[12px] font-medium text-accent">
          Drop to add to bookmarks
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === 'root'
              ? rootMenuItems()
              : menu.kind === 'folder' && menu.id
                ? folderContextItems(menu.id)
                : menu.id
                  ? bookmarkMenuItems(menu.id)
                  : []
          }
          onClose={() => setMenu(null)}
        />
      )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems(folderMenu.folderId)}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {dialog?.kind === 'add-folder' && (
        <BookmarkDialog
          title="Add Folder"
          submitLabel="Add Folder"
          onClose={() => setDialog(null)}
          onSubmit={(title) => {
            addFolder(title, dialog.parentId)
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === 'edit-folder' && (
        <BookmarkDialog
          title="Edit Folder"
          initialTitle={dialog.title}
          submitLabel="Save"
          onClose={() => setDialog(null)}
          onSubmit={(title) => {
            updateFolder(dialog.id, { title })
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === 'edit-bookmark' && (
        <BookmarkDialog
          title="Edit Bookmark"
          initialTitle={dialog.title}
          initialUrl={dialog.url}
          showUrl
          submitLabel="Save"
          onClose={() => setDialog(null)}
          onSubmit={(title, url) => {
            updateBookmark(dialog.id, { title, url })
            setDialog(null)
          }}
        />
      )}
    </nav>
  )
}
