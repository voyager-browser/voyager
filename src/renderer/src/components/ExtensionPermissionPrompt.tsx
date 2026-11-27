import { useEffect, useRef, useState } from 'react'
import { Puzzle, X } from 'lucide-react'
import { extensionPermissionLabel } from '../../../shared/permissions'
import type { ExtensionPermissionChoice, ExtensionPermissionRequest } from '../../../shared/types'
import { useOverlaySignal } from '../lib/overlay'

/**
 * Permission prompt for extension API requests. Chrome extensions request
 * capabilities by name, so the prompt lists plain-language descriptions and
 * stores the user's decision in the extension's profile settings.
 */
export function ExtensionPermissionPrompt(): React.JSX.Element | null {
  const [queue, setQueue] = useState<ExtensionPermissionRequest[]>([])
  const allowRef = useRef<HTMLButtonElement>(null)
  const blockRef = useRef<HTMLButtonElement>(null)
  const request = queue[0]
  const activeRequestId = request?.id

  useOverlaySignal(request !== undefined)

  useEffect(() => {
    const unsubscribeRequest = window.voyager.extensions.onPermissionRequest((incoming) => {
      setQueue((current) =>
        current.some((item) => item.id === incoming.id) ? current : [...current, incoming]
      )
    })
    const unsubscribeCancelled = window.voyager.extensions.onPermissionRequestCancelled(({ id }) =>
      setQueue((current) => current.filter((item) => item.id !== id))
    )
    return () => {
      unsubscribeRequest()
      unsubscribeCancelled()
    }
  }, [])

  useEffect(() => {
    if (activeRequestId) allowRef.current?.focus()
  }, [activeRequestId])

  if (!request) return null

  const choose = (choice: ExtensionPermissionChoice): void => {
    setQueue((current) => current.filter((item) => item.id !== request.id))
    void window.voyager.extensions.respondPermission(request.id, choice)
  }

  const labels = [
    ...request.permissions.map((permission) => extensionPermissionLabel(permission)),
    ...request.origins.map((origin) => extensionPermissionLabel(`origin:${origin}`))
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-permission-prompt-title"
        aria-describedby="extension-permission-prompt-description"
        className="pointer-events-auto w-[390px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            choose('dismiss')
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const focused = document.activeElement
            const next = focused === allowRef.current ? blockRef.current : allowRef.current
            next?.focus()
          }
        }}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Puzzle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="extension-permission-prompt-title" className="text-[13.5px] leading-5 text-fg">
              <span className="font-semibold">{request.extensionName}</span> wants to
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted">
              Allowing gives this extension access even when you are not using it.
            </p>
          </div>
          <button
            type="button"
            aria-label="Not this time"
            title="Not this time"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={() => choose('dismiss')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          id="extension-permission-prompt-description"
          className="border-t border-border px-4 py-3"
        >
          <ul className="space-y-2">
            {labels.map((label) => (
              <li key={label} className="text-[13px] font-medium leading-5 text-fg">
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            <button
              ref={allowRef}
              type="button"
              className="w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90"
              onClick={() => choose('allow')}
            >
              Allow
            </button>
            <button
              ref={blockRef}
              type="button"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10"
              onClick={() => choose('block')}
            >
              Never allow
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
