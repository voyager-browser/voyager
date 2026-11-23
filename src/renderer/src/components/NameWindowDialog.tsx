import { useEffect, useRef, useState } from 'react'
import { useOverlaySignal } from '../lib/overlay'

interface NameWindowDialogProps {
  open: boolean
  onClose: () => void
}

export function NameWindowDialog({
  open,
  onClose
}: NameWindowDialogProps): React.JSX.Element | null {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useOverlaySignal(open)

  useEffect(() => {
    if (!open) return
    setValue('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const submit = (): void => {
    const title = value.trim()
    if (title) void window.voyager.windows.setTitle(title)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24"
      onMouseDown={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-window-title"
        className="pointer-events-auto w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="space-y-2 px-4 py-4">
          <p id="name-window-title" className="text-[13px] font-semibold text-fg">
            Name this window
          </p>
          <input
            ref={inputRef}
            aria-label="Window name"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Window name"
            className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-fg outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            OK
          </button>
        </div>
      </form>
    </div>
  )
}
