import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { useOverlaySignal } from '../lib/overlay'
import { isNewTab } from '../../../shared/url'
import { useBrowserStore } from '../state/browserStore'
import { useUiStore } from '../state/uiStore'

function prettifyUrl(url: string): string {
  if (isNewTab(url)) return 'New tab'
  try {
    return new URL(url).host + new URL(url).pathname
  } catch {
    return url
  }
}

export function TabSearchPalette(): React.JSX.Element | null {
  const open = useUiStore((state) => state.tabSearchOpen)
  const closeTabSearch = useUiStore((state) => state.closeTabSearch)

  const tabs = useBrowserStore((state) => state.tabs)
  const activeTabId = useBrowserStore((state) => state.activeTabId)
  const activateTab = useBrowserStore((state) => state.activateTab)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Expand the chrome view so the palette's full-window backdrop works.
  useOverlaySignal(open)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tabs
    return tabs.filter(
      (tab) => tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
    )
  }, [query, tabs])

  if (!open) return null

  const runSelection = (): void => {
    const tab = results[selected]
    if (tab) {
      activateTab(tab.id)
      closeTabSearch()
    }
  }

  return (
    <div className="fixed inset-0 z-40" onMouseDown={closeTabSearch}>
      <div
        className="no-drag mx-auto mt-[14vh] w-[600px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/20"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search tabs"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((index) => Math.min(index + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                runSelection()
              } else if (event.key === 'Escape') {
                closeTabSearch()
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-3.5 py-3 text-[13px] text-muted">No matching tabs</p>
          ) : (
            results.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                onMouseEnter={() => setSelected(index)}
                onClick={runSelection}
                className={cn(
                  'flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors',
                  index === selected ? 'bg-hover' : 'bg-transparent',
                  tab.id === activeTabId && 'opacity-90'
                )}
              >
                {tab.loading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-hover text-[9px] font-semibold text-muted">
                    {(tab.title || '·').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">
                    {tab.title || 'New Tab'}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {prettifyUrl(tab.url)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
