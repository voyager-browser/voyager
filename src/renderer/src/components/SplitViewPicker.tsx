import { useEffect, useState } from 'react'
import { Columns2 } from 'lucide-react'
import { isNewTab } from '../../../shared/url'
import { useOverlaySignal } from '../lib/overlay'
import { useBrowserStore } from '../state/browserStore'
import { TabIcon } from './TabItem'

interface SplitRequest {
  sourceId: string
}

export function SplitViewPicker(): React.JSX.Element | null {
  const tabs = useBrowserStore((state) => state.tabs)
  const openSplit = useBrowserStore((state) => state.openSplit)
  const [request, setRequest] = useState<SplitRequest | null>(null)

  useOverlaySignal(request !== null)

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<SplitRequest>).detail
      if (detail?.sourceId) setRequest({ sourceId: detail.sourceId })
    }
    window.addEventListener('voyager:open-split-picker', onOpen)
    return () => window.removeEventListener('voyager:open-split-picker', onOpen)
  }, [])

  if (!request) return null

  const candidates = tabs.filter((tab) => tab.id !== request.sourceId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24"
      onMouseDown={() => setRequest(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose tab for split view"
        className="no-drag pointer-events-auto w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setRequest(null)
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Columns2 className="h-4 w-4 shrink-0 text-muted" />
          <p className="text-[13px] font-semibold text-fg">Choose a tab for the right side</p>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1.5">
          {candidates.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">No other tabs are open</p>
          ) : (
            candidates.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  openSplit(request.sourceId, tab.id)
                  setRequest(null)
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-hover"
              >
                <TabIcon tab={tab} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">
                    {tab.title || (isNewTab(tab.url) ? 'New Tab' : tab.url)}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">{tab.url}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
