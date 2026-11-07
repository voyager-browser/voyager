import { Copy, PanelLeft, Pin, Plus, RotateCw, Volume2, VolumeX, X } from 'lucide-react'
import type { TabState } from '../../../shared/types'
import { isNewTab } from '../../../shared/url'
import { useBrowserStore } from '../state/browserStore'
import type { ContextMenuItem } from './ui/ContextMenu'

export interface TabMenuOptions {
  verticalTabs: boolean
  onToggleVerticalTabs: () => void
}

/** Shared context-menu items for a tab in either the horizontal or vertical strip. */
export function buildTabMenuItems(tab: TabState, options: TabMenuOptions): ContextMenuItem[] {
  const store = useBrowserStore.getState()

  return [
    {
      label: 'New tab',
      icon: <Plus className="h-3.5 w-3.5" />,
      onSelect: () => store.createTab()
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
      label: tab.pinned ? 'Unpin tab' : 'Pin tab',
      icon: <Pin className="h-3.5 w-3.5" />,
      onSelect: () => store.pinToggle(tab.id)
    },
    {
      label: tab.muted ? 'Unmute tab' : 'Mute tab',
      icon: tab.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />,
      onSelect: () => store.muteToggle(tab.id)
    },
    { separator: true },
    {
      label: 'Copy URL',
      icon: <Copy className="h-3.5 w-3.5" />,
      disabled: isNewTab(tab.url),
      onSelect: () => store.copyTabUrl(tab.id)
    },
    { separator: true },
    {
      label: 'Close tab',
      icon: <X className="h-3.5 w-3.5" />,
      onSelect: () => store.closeTab(tab.id)
    },
    {
      label: 'Close other tabs',
      onSelect: () => store.closeOthers(tab.id)
    },
    {
      label: 'Close tabs to the right',
      onSelect: () => store.closeToRight(tab.id)
    },
    { separator: true },
    {
      label: options.verticalTabs ? 'Turn off vertical tabs' : 'Turn on vertical tabs',
      icon: <PanelLeft className="h-3.5 w-3.5" />,
      checked: options.verticalTabs,
      onSelect: options.onToggleVerticalTabs
    }
  ]
}
