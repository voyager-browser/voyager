import { Fragment, useState } from 'react'
import { Plus } from 'lucide-react'
import type { TabState } from '../../../shared/types'
import { useBrowserStore } from '../state/browserStore'
import { buildTabMenuItems } from './tabContextMenu'
import { ContextMenu } from './ui/ContextMenu'
import { TabItem } from './TabItem'

/**
 * Reorder `tabs` so that `drag` lands next to `over`, keeping pinned and
 * regular tabs in their own contiguous blocks (pinned always left).
 */
export function reorderTabs(drag: TabState, over: TabState, tabs: TabState[]): string[] {
  const ids = tabs.map((tab) => tab.id)
  const rest = ids.filter((id) => id !== drag.id)
  const at = rest.indexOf(over.id)

  if (drag.pinned === over.pinned) {
    rest.splice(at, 0, drag.id)
    return rest
  }

  if (drag.pinned) {
    // A pinned tab may only move within the pinned block.
    const lastPinned = rest.reduce<number>(
      (last, id, index) => (tabs.find((tab) => tab.id === id)?.pinned ? index : last),
      -1
    )
    rest.splice(lastPinned + 1, 0, drag.id)
    return rest
  }

  // A regular tab dropped into the pinned block lands at its head.
  const firstRegular = rest.findIndex((id) => !tabs.find((tab) => tab.id === id)?.pinned)
  rest.splice(firstRegular === -1 ? rest.length : firstRegular, 0, drag.id)
  return rest
}

interface TabMenuState {
  x: number
  y: number
  tabId: string
}

export function TabStrip(): React.JSX.Element {
  const tabs = useBrowserStore((state) => state.tabs)
  const activeTabId = useBrowserStore((state) => state.activeTabId)
  const createTab = useBrowserStore((state) => state.createTab)
  const reorderSelected = useBrowserStore((state) => state.reorderTabs)
  const activateTab = useBrowserStore((state) => state.activateTab)
  const verticalTabs = useBrowserStore((state) => state.verticalTabs)
  const toggleVerticalTabs = useBrowserStore((state) => state.toggleVerticalTabs)
  const splitTabId = useBrowserStore((state) => state.splitTabId)

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [menu, setMenu] = useState<TabMenuState | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [anchorId, setAnchorId] = useState<string | null>(null)

  const selectedIds = selection.filter((id) => tabs.some((tab) => tab.id === id))

  const handleSelect = (tabId: string, event: React.MouseEvent): void => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (event.shiftKey) {
      const anchor = anchorId ?? activeTabId ?? tabId
      const anchorIndex = tabs.findIndex((tab) => tab.id === anchor)
      if (anchorIndex !== -1 && index !== -1) {
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        setSelection(tabs.slice(start, end + 1).map((tab) => tab.id))
        setAnchorId(anchor)
        return
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelection((previous) =>
        previous.includes(tabId) ? previous.filter((id) => id !== tabId) : [...previous, tabId]
      )
      setAnchorId(tabId)
      return
    }
    setSelection([tabId])
    setAnchorId(tabId)
    activateTab(tabId)
  }

  const openMenu = (tabId: string, x: number, y: number): void => {
    if (!selection.includes(tabId)) {
      setSelection([tabId])
      setAnchorId(tabId)
    }
    setMenu({ x, y, tabId })
  }

  const handleDrop = (targetId: string): void => {
    if (dragId && dragId !== targetId) {
      const drag = tabs.find((tab) => tab.id === dragId)
      const over = tabs.find((tab) => tab.id === targetId)
      if (drag && over) {
        reorderSelected(reorderTabs(drag, over, tabs))
      }
    }
    setDragId(null)
    setOverId(null)
  }

  const menuTab = menu ? tabs.find((tab) => tab.id === menu.tabId) : undefined
  const menuItems = menuTab
    ? buildTabMenuItems(menuTab, {
        verticalTabs,
        onToggleVerticalTabs: toggleVerticalTabs,
        selectedTabIds: selectedIds
      })
    : []

  return (
    <>
      <div role="tablist" className="no-drag flex h-full min-w-0 items-end gap-0.5">
        {tabs.map((tab, index) => {
          const previous = tabs[index - 1]
          // Decorative separators make adjacent tabs easier to tell apart, but
          // the active tab already has its own surface and border.
          const showSeparator =
            previous !== undefined && previous.id !== activeTabId && tab.id !== activeTabId

          return (
            <Fragment key={tab.id}>
              {showSeparator && (
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-hidden="true"
                  data-testid="tab-separator"
                  className="h-4 w-px shrink-0 self-center bg-border"
                />
              )}
              <TabItem
                tab={tab}
                active={tab.id === activeTabId}
                selected={selectedIds.includes(tab.id)}
                split={
                  splitTabId !== null && (tab.id === splitTabId || tab.id === activeTabId)
                }
                dragging={dragId === tab.id}
                dropTarget={overId === tab.id}
                onSelect={(event) => handleSelect(tab.id, event)}
                onDragStart={setDragId}
                onDragOver={setOverId}
                onDrop={handleDrop}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                onContextMenu={(x, y) => {
                  openMenu(tab.id, x, y)
                }}
              />
            </Fragment>
          )
        })}
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          onClick={() => createTab()}
          className="no-drag -mb-px flex h-[26px] w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg active:bg-hover/70"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}
