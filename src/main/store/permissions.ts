import type { SitePermissionDecision } from '../../shared/types'

/** Persisted per-origin browser permission decisions. */
export interface PermissionsShape {
  decisions: SitePermissionDecision[]
  /** Decisions auto-removed for privacy (not visited recently); can be restored. */
  autoRemovedDecisions?: SitePermissionDecision[]
}
