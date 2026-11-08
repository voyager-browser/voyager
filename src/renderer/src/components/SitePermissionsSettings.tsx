import { useEffect, useState } from 'react'
import { ChevronLeft, Trash2 } from 'lucide-react'
import {
  PERMISSION_KINDS,
  PERMISSION_LABELS,
  permissionHostForOrigin,
  permissionOriginForUrl
} from '../../../shared/permissions'
import type { SitePermissionDecision } from '../../../shared/types'
import { cn } from '../lib/cn'
import { usePermissionsStore } from '../state/permissionsStore'

interface SitePermissionsSettingsProps {
  initialOrigin?: string
  onBack: () => void
}

export function SitePermissionsSettings({
  initialOrigin,
  onBack
}: SitePermissionsSettingsProps): React.JSX.Element {
  const decisions = usePermissionsStore((state) => state.decisions)
  const [originFilter, setOriginFilter] = useState<string | null>(
    initialOrigin ? permissionOriginForUrl(initialOrigin) : null
  )

  useEffect(() => {
    const { applyState, refresh } = usePermissionsStore.getState()
    void refresh()
    return window.voyager.permissions.onStateChanged(applyState)
  }, [])

  const visible = originFilter
    ? decisions.filter((decision) => decision.origin === originFilter)
    : decisions

  const grouped = PERMISSION_KINDS.map((kind) => ({
    kind,
    decisions: visible
      .filter((decision) => decision.kind === kind)
      .sort((a, b) => a.origin.localeCompare(b.origin))
  })).filter((group) => group.decisions.length > 0)

  return (
    <div className="h-full w-full overflow-y-auto bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button
          type="button"
          className="mb-4 flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-fg"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </button>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-fg">Site permissions</h1>
            <p className="mt-1 text-[13px] text-muted">
              Choose how sites may use location, notifications, camera, microphone and other browser
              features.
            </p>
          </div>
          {decisions.length > 0 && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-danger transition-colors hover:bg-danger/10"
              onClick={() => void usePermissionsStore.getState().clear()}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        </div>

        {originFilter && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-fg">
                Showing permissions for {permissionHostForOrigin(originFilter)}
              </p>
              <p className="truncate text-[11.5px] text-muted">{originFilter}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-[12px] text-accent hover:underline"
              onClick={() => setOriginFilter(null)}
            >
              Show all sites
            </button>
          </div>
        )}

        {grouped.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-5 py-8 text-center">
            <p className="text-[13px] text-muted">
              {originFilter
                ? `No saved permissions for ${permissionHostForOrigin(originFilter)}.`
                : 'No saved site permissions yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <section
                key={group.kind}
                className="overflow-hidden rounded-lg border border-border bg-surface"
              >
                <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold text-fg">
                  {PERMISSION_LABELS[group.kind]}
                </h2>
                <ul>
                  {group.decisions.map((decision) => (
                    <PermissionRow key={decision.origin} decision={decision} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PermissionRow({ decision }: { decision: SitePermissionDecision }): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-fg">{permissionHostForOrigin(decision.origin)}</p>
        <p className="truncate text-[11.5px] text-muted">{decision.origin}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            decision.decision === 'allow' ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'
          )}
        >
          {decision.decision === 'allow' ? 'Allowed' : 'Blocked'}
        </span>
        <button
          type="button"
          aria-label={`Remove ${PERMISSION_LABELS[decision.kind]} permission for ${permissionHostForOrigin(decision.origin)}`}
          className="text-[12px] text-muted transition-colors hover:text-danger hover:underline"
          onClick={() => void usePermissionsStore.getState().remove(decision.origin, decision.kind)}
        >
          Remove
        </button>
      </div>
    </li>
  )
}
