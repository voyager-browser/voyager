import { useState } from 'react'
import { ChevronRight, Folder, FolderPlus, Globe, Plus, X } from 'lucide-react'
import { useOverlaySignal } from '../lib/overlay'
import { isNewTab } from '../../../shared/url'
import { useActiveTab, useBrowserStore } from '../state/browserStore'
import { useBookmarksStore } from '../state/bookmarksStore'
import { BookmarkDialog } from './BookmarkDialog'
import { ContextMenu, type ContextMenuItem } from './ui/ContextMenu'
import { IconButton } from './ui/IconButton'

type DialogState =
  | { kind: 'add-folder'; parentId: string | null }
  | { kind: 'edit-folder'; id: string; title: string }
  | { kind: 'edit-bookmark'; id: string; title: string; url: string }

interface RowMenuState {
  x: number
  y: number
  kind: 'bookmark' | 'folder' | 'root'
  id?: string
}

const INTERNAL_DRAG_TYPE = 'application/x-voyager-bookmark'

function dragMime(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_TYPE)
}

/** In-chrome bookmarks manager overlay. */
export function BookmarksManager({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  useOverlaySignal(open)

  const folders = useBookmarksStore((state) => state.folders)
  const items = useBookmarksStore((state) => state.items)
  const clipboard = useBookmarksStore((state) => state.clipboard)
  const addBookmark = useBookmarksStore((state) => state.addBookmark)
  const removeBookmark = useBookmarksStore((state) => state.removeBookmark)
  const updateBookmark = useBookmarksStore((state) => state.updateBookmark)
  const updateFolder = useBookmarksStore((state) => state.updateFolder)
  const removeFolder = useBookmarksStore((state) => state.removeFolder)
  const move = useBookmarksStore((state) => state.move)
  const cut = useBookmarksStore((state) => state.cut)
  const copy = useBookmarksStore((state) => state.copy)
  const paste = useBookmarksStore((state) => state.paste)
  const navigate = useBrowserStore((state) => state.navigate)
  const activeTab = useActiveTab()

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [menu, setMenu] = useState<RowMenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dropActive, setDropActive] = useState(false)

  if (!open) return null

  const childFolders = folders.filter((folder) => folder.parentId === selectedFolder)
  const childItems = items.filter((item) => (item.folderId ?? null) === selectedFolder)
  const selectedFolderName =
    selectedFolder === null
      ? 'Bookmarks Bar'
      : (folders.find((folder) => folder.id === selectedFolder)?.title ?? 'Bookmarks')

  const bookmarkMenu = (id: string): ContextMenuItem[] => {
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

  const folderMenu = (id: string): ContextMenuItem[] => {
    const folder = folders.find((candidate) => candidate.id === id)
    if (!folder) return []
    return [
      { label: 'Open', onSelect: () => setSelectedFolder(folder.id) },
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
    setDropActive(false)
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
    if (url) addBookmark(url, url, null, parentId)
  }

  const renderFolderTree = (parentId: string | null, depth: number): React.JSX.Element[] =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .flatMap((folder) => [
        <button
          key={folder.id}
          type="button"
          onClick={() => setSelectedFolder(folder.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ x: event.clientX, y: event.clientY, kind: 'folder', id: folder.id })
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = dragMime(event) ? 'move' : 'copy'
          }}
          onDrop={(event) => void handleDrop(event, folder.id)}
          className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] ${
            selectedFolder === folder.id ? 'bg-hover text-fg' : 'text-fg hover:bg-hover'
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="truncate">{folder.title}</span>
        </button>,
        ...renderFolderTree(folder.id, depth + 1)
      ])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Bookmarks Manager"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[min(680px,86vh)] w-[min(980px,94vw)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg/50">
          <div className="flex items-center justify-between border-b border-border px-3 py-3">
            <span className="text-[13px] font-semibold text-fg">Bookmarks</span>
            <IconButton
              label="New folder"
              className="h-6 w-6"
              onClick={() => setDialog({ kind: 'add-folder', parentId: selectedFolder })}
            >
              <FolderPlus className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => setSelectedFolder(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, kind: 'root' })
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = dragMime(event) ? 'move' : 'copy'
              }}
              onDrop={(event) => void handleDrop(event, null)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] ${
                selectedFolder === null ? 'bg-hover text-fg' : 'text-fg hover:bg-hover'
              }`}
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate">Bookmarks Bar</span>
            </button>
            {renderFolderTree(null, 1)}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-fg">{selectedFolderName}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={activeTab === undefined || isNewTab(activeTab.url)}
                onClick={() => {
                  if (activeTab) {
                    addBookmark(
                      activeTab.title || activeTab.url,
                      activeTab.url,
                      activeTab.favicon,
                      selectedFolder
                    )
                  }
                }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-fg hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Page
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'add-folder', parentId: selectedFolder })}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-fg hover:bg-hover"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Add Folder
              </button>
              <button
                type="button"
                disabled={clipboard === null}
                onClick={() => paste(selectedFolder)}
                className="rounded-md px-2 py-1 text-[12px] text-fg hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
              >
                Paste
              </button>
              <IconButton label="Close bookmarks manager" className="h-6 w-6" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </header>

          <div
            className={`relative flex-1 overflow-y-auto p-2 ${dropActive ? 'bg-accent/5' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = dragMime(event) ? 'move' : 'copy'
              setDropActive(true)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setDropActive(false)
            }}
            onDrop={(event) => void handleDrop(event, selectedFolder)}
          >
            {childFolders.length === 0 && childItems.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted">
                This folder is empty. Drag bookmarks here or use Add Page.
              </p>
            ) : null}

            {childFolders.map((folder) => (
              <div
                key={folder.id}
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
                  event.dataTransfer.dropEffect = dragMime(event) ? 'move' : 'copy'
                }}
                onDrop={(event) => void handleDrop(event, folder.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, kind: 'folder', id: folder.id })
                }}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-hover"
              >
                <Folder className="h-4 w-4 shrink-0 text-muted" />
                <button
                  type="button"
                  onClick={() => setSelectedFolder(folder.id)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-fg"
                >
                  {folder.title}
                </button>
                <span className="text-[11.5px] text-muted">
                  {items.filter((item) => (item.folderId ?? null) === folder.id).length} items
                </span>
              </div>
            ))}

            {childItems.map((bookmark) => (
              <div
                key={bookmark.id}
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
                  event.dataTransfer.dropEffect = dragMime(event) ? 'move' : 'copy'
                }}
                onDrop={(event) => void handleDrop(event, bookmark.folderId ?? null, bookmark.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, kind: 'bookmark', id: bookmark.id })
                }}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-hover"
              >
                {bookmark.favicon ? (
                  <img src={bookmark.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                ) : (
                  <Globe className="h-4 w-4 shrink-0 text-muted" />
                )}
                <button
                  type="button"
                  onClick={() => navigate(bookmark.url)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px] text-fg">{bookmark.title}</span>
                  <span className="block truncate text-[11.5px] text-muted">{bookmark.url}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === 'bookmark' && menu.id
              ? bookmarkMenu(menu.id)
              : menu.kind === 'folder' && menu.id
                ? folderMenu(menu.id)
                : [
                    {
                      label: 'Add Folder…',
                      onSelect: () => setDialog({ kind: 'add-folder', parentId: selectedFolder })
                    },
                    { label: 'Paste', disabled: clipboard === null, onSelect: () => paste(null) }
                  ]
          }
          onClose={() => setMenu(null)}
        />
      )}

      {dialog?.kind === 'add-folder' && (
        <BookmarkDialog
          title="Add Folder"
          submitLabel="Add Folder"
          onClose={() => setDialog(null)}
          onSubmit={async (title) => {
            const state = await window.voyager.bookmarks.addFolder({
              title,
              parentId: dialog.parentId
            })
            useBookmarksStore.getState().applyState(state)
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
    </div>
  )
}
