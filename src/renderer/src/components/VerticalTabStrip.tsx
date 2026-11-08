import { useEffect, useState } from 'react'
import { PanelLeft, Plus, Volume2, VolumeX, X } from 'lucide-react'
import type { TabState } from '../../../shared/types'
import { VERTICAL_TAB_RAIL_COMPACT_WIDTH, VERTICAL_TAB_RAIL_WIDTH } from '../../../shared/constants'
import { cn } from '../lib/cn'
import { useBrowserStore } from '../state/browserStore'
import { reorderTabs } from './TabStrip'
import { TabIcon } from './TabItem'
import { buildTabMenuItems } from './tabContextMenu'
import { ContextMenu } from './ui/ContextMenu'

interface RailMenuState {
  x: number
  y: number
  tabId: string | null
}

/** Header height that clears the macOS traffic lights. */
const RAIL_HEADER_HEIGHT = 40

/**
 * Chrome-style vertical tab rail. It stays compact (favicons only) and expands
 * over the page while the pointer is inside it so tab titles become readable.
 * The expansion is mirrored in the main process, which raises the chrome view
 * above the page for the duration of the hover.
 */
export function VerticalTabStrip(): React.JSX.Element {
  const tabs = useBrowserStore((state) => state.tabs)
  const activeTabId = useBrowserStore((state) => state.activeTabId)
  const createTab = useBrowserStore((state) => state.createTab)
  const reorderSelected = useBrowserStore((state) => state.reorderTabs)
  const activateTab = useBrowserStore((state) => state.activateTab)
  const closeTab = useBrowserStore((state) => state.closeTab)
  const toggleVerticalTabs = useBrowserStore((state) => state.toggleVerticalTabs)

  const [expanded, setExpanded] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [menu, setMenu] = useState<RailMenuState | null>(null)

  useEffect(() => {
    void window.voyager.ui.setRailExpanded(expanded)
  }, [expanded])

  // Never leave the chrome view raised above the page after switching modes.
  useEffect(() => {
    return () => {
      void window.voyager.ui.setRailExpanded(false)
    }
  }, [])

  // A window blur does not always produce a mouseleave, so collapse explicitly
  // to avoid leaving the transparent chrome view above the page.
  useEffect(() => {
    const collapse = (): void => setExpanded(false)
    window.addEventListener('blur', collapse)
    return () => window.removeEventListener('blur', collapse)
  }, [])

  const handleDrop = (targetId: string): void => {
    if (dragId && dragId !== targetId) {
      const drag = tabs.find((tab) => tab.id === dragId)
      const over = tabs.find((tab) => tab.id === targetId)
      if (drag && over) reorderSelected(reorderTabs(drag, over, tabs))
    }
    setDragId(null)
    setOverId(null)
  }

  const menuTab = menu?.tabId ? tabs.find((tab) => tab.id === menu.tabId) : undefined
  const menuItems = menuTab
    ? buildTabMenuItems(menuTab, {
        verticalTabs: true,
        onToggleVerticalTabs: toggleVerticalTabs
      })
    : [
        {
          label: 'New tab',
          icon: <Plus className="h-3.5 w-3.5" />,
          onSelect: () => createTab()
        },
        { separator: true },
        {
          label: 'Turn off vertical tabs',
          icon: <PanelLeft className="h-3.5 w-3.5" />,
          checked: true,
          onSelect: toggleVerticalTabs
        }
      ]

  return (
    <aside
      aria-label="Tabs"
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-150 ease-out"
      style={{ width: expanded ? VERTICAL_TAB_RAIL_WIDTH : VERTICAL_TAB_RAIL_COMPACT_WIDTH }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, tabId: null })
      }}
    >
      <div
        className="drag flex shrink-0 items-end justify-end px-2 pb-1"
        style={{ height: RAIL_HEADER_HEIGHT }}
      >
        {window.voyager.platform !== 'darwin' && (
          <button
            type="button"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={() => toggleVerticalTabs()}
            aria-label="Use horizontal tabs"
            title="Use horizontal tabs"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Tabs"
        className="no-drag flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1.5 pb-2"
      >
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          onClick={() => createTab()}
          className={cn(
            'flex h-8 shrink-0 items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg',
            expanded ? 'gap-2 px-2' : 'justify-center'
          )}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {expanded && <span className="truncate text-[12.5px]">New tab</span>}
        </button>

        {tabs.map((tab) => (
          <VerticalTabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            expanded={expanded}
            dragging={dragId === tab.id}
            dropTarget={overId === tab.id}
            onActivate={() => activateTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onDragStart={() => setDragId(tab.id)}
            onDragOver={() => setOverId(tab.id)}
            onDrop={() => handleDrop(tab.id)}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onContextMenu={(x, y) => {
              activateTab(tab.id)
              setMenu({ x, y, tabId: tab.id })
            }}
          />
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </aside>
  )
}

interface VerticalTabItemProps {
  tab: TabState
  active: boolean
  expanded: boolean
  dragging: boolean
  dropTarget: boolean
  onActivate: () => void
  onClose: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onContextMenu: (x: number, y: number) => void
}

function VerticalTabItem({
  tab,
  active,
  expanded,
  dragging,
  dropTarget,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onContextMenu
}: VerticalTabItemProps): React.JSX.Element {
  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={tab.title || 'New Tab'}
      draggable
      title={tab.title || tab.url}
      onClick={onActivate}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      onMouseDown={(event) => {
        if (event.button === 2) {
          event.preventDefault()
          onContextMenu(event.clientX, event.clientY)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event.clientX, event.clientY)
      }}
      className={cn(
        'group flex h-8 shrink-0 items-center rounded-md transition-colors',
        expanded ? 'gap-2 px-2' : 'justify-center',
        active ? 'bg-surface text-fg' : 'text-muted hover:bg-hover hover:text-fg',
        dragging && 'opacity-40',
        dropTarget && 'ring-1 ring-inset ring-accent'
      )}
    >
      <TabIcon tab={tab} />

      {expanded && (
        <span className="min-w-0 flex-1 truncate text-[12.5px] leading-none">
          {tab.title || 'New Tab'}
        </span>
      )}

      {expanded && tab.hasAudio && !active && <Volume2 className="h-3.5 w-3.5 shrink-0" />}
      {expanded && tab.muted && <VolumeX className="h-3.5 w-3.5 shrink-0" />}

      {expanded && (
        <button
          type="button"
          aria-label={`Close ${tab.title || 'tab'}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted',
            'transition-opacity hover:bg-hover hover:text-fg',
            active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60'
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
