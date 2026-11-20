import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useBrowserStore } from '../state/browserStore'
import { cn } from '../lib/cn'
import { TabStrip } from './TabStrip'
import { buildTabBarMenuItems } from './tabContextMenu'
import { ContextMenu } from './ui/ContextMenu'
import { WindowControls } from './ui/WindowControls'

interface BarMenuState {
  x: number
  y: number
}

export function TitleBar(): React.JSX.Element {
  const isMac = window.voyager.platform === 'darwin'
  const verticalTabs = useBrowserStore((state) => state.verticalTabs)
  const toggleVerticalTabs = useBrowserStore((state) => state.toggleVerticalTabs)
  const [menu, setMenu] = useState<BarMenuState | null>(null)

  return (
    <header
      className={cn(
        'drag flex h-10 shrink-0 items-center border-b border-border bg-bg',
        isMac ? 'pl-[76px]' : 'pl-2'
      )}
      onContextMenu={(event) => {
        event.preventDefault()
        // Tabs and already-open menus handle their own right-clicks. A gesture
        // can produce a second contextmenu that lands on the menu just opened,
        // so exclude those targets to keep the strip menu exclusive.
        const target = event.target as HTMLElement
        if (target.closest('[role="tab"], [role="menu"]')) return
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <TabStrip />
      {/* Trailing area stays draggable where the app owns the title bar */}
      <div className="h-full flex-1" />
      {!isMac && (
        <button
          type="button"
          className="no-drag mr-1 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
          onClick={() => void window.voyager.settings.open()}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildTabBarMenuItems({
            verticalTabs,
            onToggleVerticalTabs: toggleVerticalTabs
          })}
          onClose={() => setMenu(null)}
        />
      )}
      <WindowControls />
    </header>
  )
}
