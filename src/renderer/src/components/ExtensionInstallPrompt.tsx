import { useEffect, useRef, useState } from 'react'
import { Puzzle, X } from 'lucide-react'
import { extensionPermissionLabels } from '../../../shared/permissions'
import type { ExtensionInstallChoice, ExtensionInstallRequest } from '../../../shared/types'
import { useOverlaySignal } from '../lib/overlay'

/**
 * Chrome-style install consent. The request is routed to the main browser
 * window because that is where Chrome shows extension confirmation, even when
 * the install started in Settings.
 */
export function ExtensionInstallPrompt(): React.JSX.Element | null {
  const [queue, setQueue] = useState<ExtensionInstallRequest[]>([])
  const installRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const request = queue[0]
  const activeRequestId = request?.id

  useOverlaySignal(request !== undefined)

  useEffect(() => {
    return window.voyager.extensions.onInstallRequest((incoming) => {
      setQueue((current) =>
        current.some((item) => item.id === incoming.id) ? current : [...current, incoming]
      )
    })
  }, [])

  useEffect(() => {
    if (activeRequestId) installRef.current?.focus()
  }, [activeRequestId])

  if (!request) return null

  const choose = (choice: ExtensionInstallChoice): void => {
    setQueue((current) => current.filter((item) => item.id !== request.id))
    void window.voyager.extensions.respondInstall(request.id, choice)
  }

  const labels = [
    ...new Set([
      ...request.permissions.flatMap((permission) => extensionPermissionLabels(permission)),
      ...request.origins.flatMap((origin) => extensionPermissionLabels(`origin:${origin}`))
    ])
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-install-prompt-title"
        aria-describedby="extension-install-prompt-description"
        className="pointer-events-auto w-[410px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            choose('cancel')
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const focused = document.activeElement
            const next = focused === installRef.current ? cancelRef.current : installRef.current
            next?.focus()
          }
        }}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          {request.iconUrl ? (
            <img
              src={request.iconUrl}
              alt=""
              className="mt-0.5 h-9 w-9 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Puzzle className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p id="extension-install-prompt-title" className="text-[13.5px] leading-5 text-fg">
              Add <span className="font-semibold">{request.name}</span>?
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted">Version {request.version}</p>
          </div>
          <button
            type="button"
            aria-label="Cancel install"
            title="Cancel install"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={() => choose('cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div id="extension-install-prompt-description" className="border-t border-border px-4 py-3">
          <p className="text-[12px] text-muted">This extension can:</p>
          {labels.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {labels.map((label) => (
                <li key={label} className="text-[13px] font-medium leading-5 text-fg">
                  {label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] leading-5 text-fg">No special permissions requested.</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
              onClick={() => choose('cancel')}
            >
              Cancel
            </button>
            <button
              ref={installRef}
              type="button"
              className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90"
              onClick={() => choose('install')}
            >
              Install extension
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
