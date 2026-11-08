import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useOverlaySignal } from '../lib/overlay'

interface QrOpenDetail {
  url?: string
}

export function QrCodeDialog(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useOverlaySignal(open)

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<QrOpenDetail>).detail
      setUrl(detail?.url && detail.url !== 'about:blank' ? detail.url : '')
      setOpen(true)
    }
    window.addEventListener('voyager:open-qr-code', onOpen as EventListener)
    return () => window.removeEventListener('voyager:open-qr-code', onOpen as EventListener)
  }, [])

  useEffect(() => {
    if (!open) return
    const value = url.trim()
    if (!value) {
      setDataUrl(null)
      setError(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(value, { width: 256, margin: 1 })
      .then((result) => {
        if (!cancelled) {
          setDataUrl(result)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null)
          setError('Could not generate a QR code for this URL.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  if (!open) return null

  const close = (): void => setOpen(false)

  const exportPng = (): void => {
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'page-qr-code.png'
    link.click()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
        className="pointer-events-auto w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      >
        <div className="space-y-3 px-4 py-4">
          <p id="qr-title" className="text-[13px] font-semibold text-fg">
            QR code
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">URL</span>
            <input
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-fg outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-ring"
              placeholder="https://example.com"
              autoFocus
            />
          </label>
          <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-border bg-bg p-3">
            {dataUrl ? (
              <img src={dataUrl} alt="QR code" className="h-40 w-40" />
            ) : (
              <span className="text-[12px] text-muted">
                {error ?? 'Enter a URL to generate a QR code.'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
            onClick={close}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            onClick={exportPng}
            disabled={!dataUrl}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
