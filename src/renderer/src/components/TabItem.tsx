import { Columns2, Loader2, Volume2, VolumeX, X } from 'lucide-react'
import type { TabState } from '../../../shared/types'
import { cn } from '../lib/cn'
import { useBrowserStore } from '../state/browserStore'

interface TabItemProps {
  tab: TabState
  active: boolean
  selected: boolean
  split: boolean
  dragging: boolean
  dropTarget: boolean
  onSelect: (event: React.MouseEvent) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  onContextMenu: (x: number, y: number) => void
}

export function TabItem({
  tab,
  active,
  selected,
  split,
  dragging,
  dropTarget,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onContextMenu
}: TabItemProps): React.JSX.Element {
  const closeSelected = useBrowserStore((state) => state.closeTab)

  if (tab.pinned) {
    return (
      <div
        role="tab"
        aria-selected={active}
        draggable
        title={tab.title}
        onClick={onSelect}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', tab.id)
          event.dataTransfer.effectAllowed = 'move'
          onDragStart(tab.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          onDragOver(tab.id)
        }}
        onDrop={(event) => {
          event.preventDefault()
          onDrop(tab.id)
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
          onContextMenu(event.clientX, event.clientY)
        }}
        className={cn(
          'no-drag flex h-[31px] w-[36px] shrink-0 items-center justify-center rounded-t-[9px] border border-b-0',
          'transition-colors',
          active ? 'border-border bg-surface' : 'border-transparent hover:bg-hover',
          selected && !active && 'bg-hover/70',
          split && 'ring-1 ring-inset ring-accent/60',
          dragging && 'opacity-40',
          dropTarget && 'border-l-2 border-l-accent'
        )}
      >
        <TabIcon tab={tab} />
      </div>
    )
  }

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart(tab.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver(tab.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(tab.id)
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
        onContextMenu(event.clientX, event.clientY)
      }}
      title={tab.url || tab.title}
      className={cn(
        'no-drag group -mb-px flex h-[31px] min-w-[110px] max-w-[220px] flex-1 items-center gap-2 rounded-t-[9px] border border-b-0 px-2.5 transition-colors',
        active
          ? 'border-border bg-surface text-fg'
          : 'border-transparent text-muted hover:bg-hover hover:text-fg',
        selected && !active && 'bg-hover/70 text-fg',
        split && 'ring-1 ring-inset ring-accent/60',
        dragging && 'opacity-40',
        dropTarget && 'border-l-2 border-l-accent'
      )}
    >
      <TabIcon tab={tab} />

      <span className="min-w-0 flex-1 truncate text-[12.5px] leading-none">
        {tab.title || 'New Tab'}
      </span>

      {split && <Columns2 className="h-3.5 w-3.5 shrink-0 text-accent" />}
      {tab.hasAudio && !active && <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted" />}
      {tab.muted && <VolumeX className="h-3.5 w-3.5 shrink-0 text-muted" />}

      <button
        type="button"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={(event) => {
          event.stopPropagation()
          closeSelected(tab.id)
        }}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted',
          'transition-opacity hover:bg-hover hover:text-fg',
          active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60'
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function TabIcon({ tab }: { tab: TabState }): React.JSX.Element {
  if (tab.crashed) {
    return <span className="flex h-4 w-4 items-center justify-center text-[10px]">⚠️</span>
  }
  if (tab.loading) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
  }
  if (tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        className="h-4 w-4 shrink-0 rounded-sm"
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
      />
    )
  }
  const letter = (tab.title || '?').trim().charAt(0).toUpperCase() || '·'
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-hover text-[10px] font-semibold text-muted">
      {letter}
    </span>
  )
}
