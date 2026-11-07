import { useEffect, useRef, useState } from 'react'
import type { PromptRequest } from '../../../shared/types'
import { useOverlaySignal } from '../lib/overlay'

/**
 * Renders `window.prompt()` requests for tabs. The tab renderer is blocked in
 * synchronous IPC until this dialog answers, so it deliberately does not use
 * the browser's own (unsupported) prompt implementation.
 */
export function PromptDialog(): React.JSX.Element | null {
  const [queue, setQueue] = useState<PromptRequest[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const request = queue[0]
  const requestId = request?.id
  const defaultValue = request?.defaultValue ?? ''
  const [value, setValue] = useState(defaultValue)

  useOverlaySignal(request !== undefined)

  useEffect(() => {
    const unsubscribe = window.voyager.ui.onPromptRequest((incoming) => {
      setQueue((current) =>
        current.some((item) => item.id === incoming.id) ? current : [...current, incoming]
      )
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!requestId) return
    setValue(defaultValue)
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [requestId, defaultValue])

  if (!request) return null

  const finish = (result: string | null): void => {
    setQueue((current) => current.filter((item) => item.id !== request.id))
    void window.voyager.ui.respondToPrompt(request.id, result)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        className="pointer-events-auto w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onSubmit={(event) => {
          event.preventDefault()
          finish(value)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(null)
          }
        }}
      >
        <div className="space-y-3 px-4 py-4">
          <p id="prompt-title" className="text-[13px] font-semibold text-fg">
            {request.domain} would like to ask:
          </p>
          {request.message !== '' && (
            <p id="prompt-message" className="whitespace-pre-wrap break-words text-[13px] text-fg">
              {request.message}
            </p>
          )}
          <input
            ref={inputRef}
            id="prompt-input"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-fg outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
            onClick={() => finish(null)}
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
