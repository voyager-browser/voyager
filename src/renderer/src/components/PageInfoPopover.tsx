import { useEffect, useRef, useState } from 'react'
import { Globe, Lock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { PERMISSION_LABELS, permissionOriginForUrl } from '../../../shared/permissions'
import type { ContentBlockingStats } from '../../../shared/types'
import { hasTlsCertificate, safeParseUrl, securityLevelFor } from '../../../shared/url'
import { cn } from '../lib/cn'
import { useOriginPermissions, usePermissionsStore } from '../state/permissionsStore'
import { CertificateDialog } from './CertificateDialog'

interface PageInfoPopoverProps {
  url: string
  title: string
}

export function PageInfoPopover({ url, title }: PageInfoPopoverProps): React.JSX.Element {
  const level = securityLevelFor(url)
  const parsed = safeParseUrl(url)
  const origin = permissionOriginForUrl(url)
  const sitePermissions = useOriginPermissions(origin)
  const [certificateOpen, setCertificateOpen] = useState(false)
  const [stats, setStats] = useState<ContentBlockingStats | null>(null)
  const [siteBusy, setSiteBusy] = useState(false)
  // Keep stale interval responses from reverting an optimistic toggle.
  const siteChangePending = useRef(false)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.voyager.contentBlocking
        .getStats()
        .then((next) => {
          if (active && !siteChangePending.current) setStats(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [url])

  const setSiteBlocking = async (enabled: boolean): Promise<void> => {
    if (!stats?.site) return
    const previous = stats
    const site = stats.site
    siteChangePending.current = true
    setStats({ ...previous, siteEnabled: enabled })
    setSiteBusy(true)
    try {
      setStats(await window.voyager.contentBlocking.setSiteEnabled(site, enabled))
    } catch {
      setStats(previous)
    } finally {
      siteChangePending.current = false
      setSiteBusy(false)
    }
  }

  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/15">
      {certificateOpen && <CertificateDialog url={url} onClose={() => setCertificateOpen(false)} />}
      <div className="border-b border-border px-3.5 py-3">
        <p className="truncate text-[13px] font-medium text-fg">{title || 'Untitled'}</p>
        <p className="truncate text-[11.5px] text-muted">{parsed?.host ?? 'Local tab'}</p>
      </div>

      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            level === 'secure' && 'bg-accent/10 text-accent',
            level === 'insecure' && 'bg-danger/10 text-danger',
            level === 'neutral' && 'bg-hover text-muted'
          )}
        >
          {level === 'secure' ? (
            <ShieldCheck className="h-4 w-4" />
          ) : level === 'insecure' ? (
            <TriangleAlert className="h-4 w-4" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-fg">
            {level === 'secure' && 'Connection is secure'}
            {level === 'insecure' && 'Connection is not secure'}
            {level === 'neutral' && 'Local browser tab'}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {level === 'secure' &&
              'Your information (for example, passwords or credit card numbers) is private when it is sent to this site.'}
            {level === 'insecure' &&
              'Information sent over this connection could be read or changed by others. Consider using HTTPS.'}
            {level === 'neutral' && 'This is a page owned by the browser itself.'}
          </p>
        </div>
      </div>

      {level === 'insecure' && (
        <p className="flex items-center gap-1.5 px-3.5 pb-3 text-[11.5px] text-danger">
          <Lock className="h-3 w-3" /> Use HTTPS to protect your data
        </p>
      )}

      {stats && (
        <div className="border-t border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-medium text-fg">Tracker blocking</p>
            {stats.site && (
              <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
                <input
                  type="checkbox"
                  aria-label="Block trackers on this site"
                  checked={stats.enabled && stats.siteEnabled}
                  disabled={siteBusy || !stats.enabled}
                  onChange={(event) => void setSiteBlocking(event.target.checked)}
                />
                <span>Block here</span>
              </label>
            )}
          </div>

          {!stats.enabled ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Tracker blocking is off for this profile. Turn it on in Settings to use the Block here
              toggle and stop ads and trackers from loading.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[11.5px] text-muted">
                {stats.pageBlocked === 0
                  ? 'No requests blocked on this page.'
                  : `${stats.pageBlocked} request${
                      stats.pageBlocked === 1 ? '' : 's'
                    } blocked on this page.`}
              </p>
              {stats.pageHosts.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {stats.pageHosts.slice(0, 3).map((entry) => (
                    <li
                      key={entry.host}
                      className="flex items-center justify-between gap-3 text-[11.5px]"
                    >
                      <span className="min-w-0 truncate text-muted">{entry.host}</span>
                      <span className="shrink-0 tabular-nums text-fg">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted">
                {stats.sessionBlocked} blocked this session
              </p>
              {stats.site && !stats.siteEnabled && (
                <p className="mt-1 text-[11px] text-muted">
                  Blocking is off for {stats.site}. Use the checkbox to turn it back on.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {hasTlsCertificate(url) && (
        <div className="border-t border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-fg">Certificate</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                View the TLS certificate and export it.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-[11.5px] text-accent hover:underline"
              onClick={() => setCertificateOpen(true)}
            >
              View certificate
            </button>
          </div>
        </div>
      )}

      {origin && (
        <div className="border-t border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-medium text-fg">Site permissions</p>
            <button
              type="button"
              className="text-[11.5px] text-accent hover:underline"
              onClick={() =>
                void window.voyager.settings.open({ page: 'site-permissions', origin })
              }
            >
              Manage
            </button>
          </div>

          {sitePermissions.length === 0 ? (
            <p className="mt-1.5 text-[11.5px] text-muted">No saved permissions for this site.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {sitePermissions.map((permission) => (
                <li
                  key={permission.kind}
                  className="flex items-center justify-between gap-3 text-[11.5px]"
                >
                  <span className="min-w-0 truncate text-muted">
                    {PERMISSION_LABELS[permission.kind]}:{' '}
                    <span
                      className={cn(
                        'font-medium',
                        permission.decision === 'allow' ? 'text-fg' : 'text-danger'
                      )}
                    >
                      {permission.decision === 'allow' ? 'Allowed' : 'Blocked'}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${PERMISSION_LABELS[permission.kind]} permission`}
                    className="shrink-0 text-muted hover:text-fg hover:underline"
                    onClick={() =>
                      void usePermissionsStore.getState().remove(origin, permission.kind)
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
