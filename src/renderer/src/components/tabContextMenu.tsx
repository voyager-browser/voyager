import {
  Bookmark,
  Columns2,
  Copy,
  ExternalLink,
  PanelLeft,
  Pin,
  Plus,
  QrCode,
  RotateCcw,
  RotateCw,
  Type,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { TabState } from '../../../shared/types'
import { isNewTab } from '../../../shared/url'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useBrowserStore } from '../state/browserStore'
import type { ContextMenuItem } from './ui/ContextMenu'

export interface TabMenuOptions {
  verticalTabs: boolean
  onToggleVerticalTabs: () => void
  /** Currently selected tabs, used to offer a two-tab split without a picker. */
  selectedTabIds?: string[]
}

const isMac = window.voyager.platform === 'darwin'
const newTabShortcut = isMac ? '⌘T' : 'Ctrl+T'
const reopenShortcut = isMac ? '⌘⇧T' : 'Ctrl+Shift+T'
const closeShortcut = isMac ? '⌘W' : 'Ctrl+W'

function orientationItem(options: TabMenuOptions): ContextMenuItem {
  return {
    label: options.verticalTabs ? 'Show Tabs Horizontally' : 'Show Tabs Vertically',
    icon: <PanelLeft className="h-3.5 w-3.5" />,
    checked: options.verticalTabs,
    onSelect: options.onToggleVerticalTabs
  }
}

/** Context-menu items for the empty area of either tab strip. */
export function buildTabBarMenuItems(options: TabMenuOptions): ContextMenuItem[] {
  const browser = useBrowserStore.getState()
  const bookmarkAllTabs = useBookmarksStore.getState().bookmarkAllTabs

  return [
    {
      label: 'New Tab',
      icon: <Plus className="h-3.5 w-3.5" />,
      shortcut: newTabShortcut,
      onSelect: () => browser.createTab()
    },
    {
      label: 'Reopen Closed Tab',
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      shortcut: reopenShortcut,
      onSelect: () => browser.reopenTab()
    },
    {
      label: 'Bookmark All Tabs...',
      icon: <Bookmark className="h-3.5 w-3.5" />,
      onSelect: bookmarkAllTabs
    },
    {
      label: 'Name Window...',
      icon: <Type className="h-3.5 w-3.5" />,
      onSelect: () => window.dispatchEvent(new Event('voyager:name-window'))
    },
    { separator: true },
    orientationItem(options)
  ]
}

/** Shared context-menu items for a tab in either the horizontal or vertical strip. */
export function buildTabMenuItems(tab: TabState, options: TabMenuOptions): ContextMenuItem[] {
  const store = useBrowserStore.getState()
  const tabs = store.tabs
  const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id)
  const pinnedCount = tabs.filter((candidate) => candidate.pinned).length
  // Pinned tabs stay in their own leading block in both orientations.
  const insertIndex = tab.pinned ? pinnedCount : Math.max(0, tabIndex + 1)
  const splitSelection = options.selectedTabIds?.length === 2 ? options.selectedTabIds : null

  return [
    {
      label: options.verticalTabs ? 'New Tab Below' : 'New Tab to the Right',
      icon: <Plus className="h-3.5 w-3.5" />,
      onSelect: () => store.createTab({ index: insertIndex })
    },
    {
      label: 'Add Tab to New Split View',
      icon: <Columns2 className="h-3.5 w-3.5" />,
      onSelect: () => {
        if (splitSelection) {
          store.openSplit(splitSelection[0], splitSelection[1])
          return
        }
        window.dispatchEvent(
          new CustomEvent('voyager:open-split-picker', { detail: { sourceId: tab.id } })
        )
      }
    },
    ...(store.splitTabId
      ? [
          {
            label: 'Exit Split View',
            icon: <Columns2 className="h-3.5 w-3.5" />,
            onSelect: () => store.closeSplit()
          }
        ]
      : []),
    {
      label: 'Move Tab to New Window',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      onSelect: () => store.moveTabToWindow(tab.id)
    },
    { separator: true },
    {
      label: 'Reload',
      icon: <RotateCw className="h-3.5 w-3.5" />,
      onSelect: () => store.reload()
    },
    {
      label: 'Duplicate',
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => store.duplicateTab(tab.id)
    },
    {
      label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
      icon: <Pin className="h-3.5 w-3.5" />,
      onSelect: () => store.pinToggle(tab.id)
    },
    {
      label: tab.muted ? 'Unmute Site' : 'Mute Site',
      icon: tab.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />,
      onSelect: () => store.muteToggle(tab.id)
    },
    { separator: true },
    orientationItem(options),
    { separator: true },
    {
      label: 'Close',
      icon: <X className="h-3.5 w-3.5" />,
      shortcut: closeShortcut,
      onSelect: () => store.closeTab(tab.id)
    },
    {
      label: 'Close Other Tabs',
      onSelect: () => store.closeOthers(tab.id)
    },
    {
      label: options.verticalTabs ? 'Close Tabs Below' : 'Close Tabs to the Right',
      disabled: tabIndex === tabs.length - 1,
      onSelect: () => store.closeToRight(tab.id)
    },
    { separator: true },
    {
      label: 'Copy URL',
      icon: <Copy className="h-3.5 w-3.5" />,
      disabled: isNewTab(tab.url),
      onSelect: () => store.copyTabUrl(tab.id)
    },
    {
      label: 'Generate QR code',
      icon: <QrCode className="h-3.5 w-3.5" />,
      disabled: isNewTab(tab.url),
      onSelect: () =>
        window.dispatchEvent(
          new CustomEvent('voyager:open-qr-code', { detail: { url: tab.url } })
        )
    }
  ]
}
