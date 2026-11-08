import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import type { CertificateDetails, CertificateExportFormat } from '../../../shared/types'
import { cn } from '../lib/cn'

interface CertificateDialogProps {
  url: string
  onClose: () => void
}

function Field({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-[12px] text-fg',
          mono && 'font-mono text-[11px] leading-relaxed'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

/** Modal that lazily fetches and displays the active page's TLS certificate. */
export function CertificateDialog({ url, onClose }: CertificateDialogProps): React.JSX.Element {
  const [details, setDetails] = useState<CertificateDetails | null | undefined>(undefined)
  const [exporting, setExporting] = useState<CertificateExportFormat | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetails(undefined)
    void window.voyager.certificates.get(url).then((value) => {
      if (!cancelled) setDetails(value)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const runExport = async (format: CertificateExportFormat): Promise<void> => {
    setExporting(format)
    setExportError(null)
    setExportedPath(null)
    try {
      const path = await window.voyager.certificates.export(url, format)
      if (path) setExportedPath(path)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the certificate.')
    } finally {
      setExporting(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Certificate"
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/30"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-fg">Certificate</h2>
            <p className="truncate text-[11.5px] text-muted">{details?.host ?? url}</p>
          </div>
          <button
            type="button"
            aria-label="Close certificate viewer"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {details === undefined && (
            <p className="py-8 text-center text-[13px] text-muted">Reading certificate…</p>
          )}

          {details === null && (
            <p className="py-8 text-center text-[13px] text-danger">
              Certificate details are not available for this site.
            </p>
          )}

          {details && (
            <div className="space-y-5">
              <section>
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Issued to
                </h3>
                <dl className="divide-y divide-border/60">
                  <Field label="Common name" value={details.subject} />
                  <Field label="Subject alternative names" value={details.subjectAltName} />
                  <Field label="Serial number" value={details.serialNumber} mono />
                </dl>
              </section>

              <section>
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Issued by
                </h3>
                <dl className="divide-y divide-border/60">
                  <Field label="Issuer" value={details.issuer} />
                  <Field label="Valid from" value={details.validFrom} />
                  <Field label="Valid to" value={details.validTo} />
                </dl>
              </section>

              <section>
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Fingerprints
                </h3>
                <dl className="divide-y divide-border/60">
                  <Field label="SHA-256" value={details.fingerprint256} mono />
                  <Field label="SHA-1" value={details.fingerprint} mono />
                  <Field label="SHA-512" value={details.fingerprint512} mono />
                </dl>
              </section>

              <section>
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Public key
                </h3>
                <dl className="divide-y divide-border/60">
                  <Field label="Algorithm" value={details.publicKey} />
                  <Field label="Key usage" value={details.keyUsage} />
                  <Field label="Certificate authority" value={details.isCA ? 'Yes' : 'No'} />
                </dl>
              </section>

              {details.chain.length > 1 && (
                <section>
                  <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
                    Certificate chain
                  </h3>
                  <ol className="space-y-2">
                    {details.chain.map((entry, index) => (
                      <li
                        key={`${entry.fingerprint256}-${index}`}
                        className="rounded-md border border-border bg-bg px-3 py-2"
                      >
                        <p className="text-[12px] text-fg">
                          {index === 0 ? 'Leaf' : entry.isCA ? 'CA' : 'Intermediate'} ·{' '}
                          {entry.subject}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">Issued by {entry.issuer}</p>
                        <p className="mt-0.5 break-all font-mono text-[10.5px] text-muted">
                          {entry.fingerprint256}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            disabled={!details || exporting !== null}
            onClick={() => void runExport('pem')}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] text-accent-foreground disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === 'pem' ? 'Exporting…' : 'Export PEM'}
          </button>
          <button
            type="button"
            disabled={!details || exporting !== null}
            onClick={() => void runExport('der')}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-fg disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === 'der' ? 'Exporting…' : 'Export DER'}
          </button>
          {exportedPath && (
            <span className="min-w-0 truncate text-[11.5px] text-muted">
              Saved to {exportedPath}
            </span>
          )}
          {exportError && <span className="text-[11.5px] text-danger">{exportError}</span>}
        </div>
      </div>
    </div>,
    document.body
  )
}
