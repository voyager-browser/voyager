import { hasAllExtensionPermissions, requiredManifestKeys } from '../extensionPermissions'

/**
 * Manifest-required API permissions are granted with installation, matching
 * Chrome. Optional permissions still need an explicit allow decision.
 */
export function hasApiPermission(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>,
  permission: string | undefined
): boolean {
  if (!permission) return true
  if (requiredManifestKeys(manifest).includes(permission)) return true
  return hasAllExtensionPermissions(profileId, extensionId, [permission])
}

export function requireApiPermission(
  profileId: string,
  extensionId: string,
  manifest: Record<string, unknown>,
  permissions: string[]
): void {
  for (const permission of permissions) {
    if (!hasApiPermission(profileId, extensionId, manifest, permission)) {
      throw new Error(`Missing extension permission: ${permission}`)
    }
  }
}
