import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Camera,
  Clipboard,
  MapPin,
  Mic,
  Monitor,
  Music,
  ShieldCheck,
  Usb,
  X
} from 'lucide-react'
import {
  PERMISSION_ACTIONS,
  PERMISSION_LABELS
} from '../../../shared/permissions'
import type {
  PermissionKind,
  PermissionPromptRequest,
  PermissionRequestChoice
} from '../../../shared/types'
import { useOverlaySignal } from '../lib/overlay'
import { cn } from '../lib/cn'

function PermissionIcon({ kind }: { kind: PermissionKind }): React.JSX.Element {
  const className = 'h-5 w-5'
  switch (kind) {
    case 'geolocation':
      return <MapPin className={className} />
    case 'notifications':
      return <Bell className={className} />
    case 'camera':
      return <Camera className={className} />
    case 'microphone':
      return <Mic className={className} />
    case 'camera-microphone':
      return <Camera className={className} />
    case 'clipboard-read':
      return <Clipboard className={className} />
    case 'display-capture':
      return <Monitor className={className} />
    case 'midi':
      return <Music className={className} />
    case 'device-access':
      return <Usb className={className} />
    default:
      return <ShieldCheck className={className} />
  }
}

/**
 * Chrome-style permission prompt. Requests are queued by the main process so
 * only one decision is shown at a time; the X dismisses just this request.
 */
export function PermissionPrompt(): React.JSX.Element | null {
  const [queue, setQueue] = useState<PermissionPromptRequest[]>([])
  const installRef = useRef<HTMLButtonElement>(null)
  const onceRef = useRef<HTMLButtonElement>(null)
  const blockRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const request = queue[0]
  const activeRequestId = request?.id

  useOverlaySignal(request !== undefined)

  useEffect(() => {
    const unsubscribeRequest = window.voyager.permissions.onRequest((incoming) => {
      setQueue((current) =>
        current.some((item) => item.id === incoming.id) ? current : [...current, incoming]
      )
    })
    const unsubscribeCancelled = window.voyager.permissions.onRequestCancelled(({ id }) => {
      setQueue((current) => current.filter((item) => item.id !== id))
    })
    return () => {
      unsubscribeRequest()
      unsubscribeCancelled()
    }
  }, [])

  useEffect(() => {
    if (activeRequestId) installRef.current?.focus()
  }, [activeRequestId])

  if (!request) return null

  const choose = (choice: PermissionRequestChoice): void => {
    setQueue((current) => current.filter((item) => item.id !== request.id))
    void window.voyager.permissions.respond(request.id, choice)
  }

  const moveFocus = (direction: 1 | -1): void => {
    const buttons = [
      installRef.current,
      onceRef.current,
      blockRef.current,
      moreRef.current
    ].filter((button): button is HTMLButtonElement => button !== null)
    if (buttons.length === 0) return
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-prompt-title"
        aria-describedby="permission-prompt-description"
        className="pointer-events-auto w-[390px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            choose('dismiss')
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveFocus(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveFocus(-1)
          }
        }}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <PermissionIcon kind={request.kind} />
          </span>
          <div className="min-w-0 flex-1">
            <p id="permission-prompt-title" className="text-[13.5px] leading-5 text-fg">
              <span className="font-semibold">{request.host}</span> wants to
            </p>
            <p className="mt-0.5 text-[13px] font-medium leading-5 text-fg">
              {PERMISSION_ACTIONS[request.kind]}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted">
              {PERMISSION_LABELS[request.kind]} permission
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
          id="permission-prompt-description"
          className="space-y-2 border-t border-border px-4 py-3"
        >
          <button
            ref={installRef}
            type="button"
            className="w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90"
            onClick={() => choose('allow-site')}
          >
            Allow while visiting the site
          </button>
          <button
            ref={onceRef}
            type="button"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
            onClick={() => choose('allow-once')}
          >
            Allow this time
          </button>
          <div className="flex items-center gap-2">
            <button
              ref={blockRef}
              type="button"
              className={cn(
                'min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10'
              )}
              onClick={() => choose('block')}
            >
              Never allow
            </button>
            <button
              ref={moreRef}
              type="button"
              className="shrink-0 rounded-lg px-2 py-2 text-[12px] font-medium text-accent transition-colors hover:bg-hover hover:underline"
              onClick={() => {
                void window.voyager.settings.open({
                  page: 'site-permissions',
                  origin: request.origin
                })
              }}
            >
              See more
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
