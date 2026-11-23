import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface FindBarProps {
  open: boolean
  onClose: () => void
}

export function FindBar({ open, onClose }: FindBarProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [forward, setForward] = useState(true)

  useEffect(() => {
    if (!open) {
      setQuery('')
      void window.voyager.navigation.stopFindInPage()
    }
  }, [open])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    if (open) {
      // Capture so the global shortcut handler sees the prevented Escape
      // regardless of which find-bar control has focus (or listener order).
      window.addEventListener('keydown', handleKey, true)
    }
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="no-drag fixed left-1/2 top-[calc(4rem+8px)] z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-xl">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value) {
              void window.voyager.navigation.findInPage(e.target.value, forward)
            } else {
              void window.voyager.navigation.stopFindInPage()
            }
          }}
          placeholder="Find in page"
          className="w-[240px] bg-transparent text-[13px] text-fg outline-none placeholder:text-muted"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void window.voyager.navigation.findInPage(query, forward)
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            setForward((f) => {
              const nf = !f
              if (query) void window.voyager.navigation.findInPage(query, nf)
              return nf
            })
          }}
          className="rounded px-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
        >
          {forward ? 'Next' : 'Prev'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
