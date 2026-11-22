/**
 * Chrome-like profiles. Every profile owns a persistent Electron partition
 * (cookies, cache, storage) plus its own bookmarks, history, downloads, site
 * permissions and preferences. The built-in `default` profile reuses the
 * existing userData directory so current browsing data keeps working.
 */

export const DEFAULT_PROFILE_ID = 'default'

export interface ProfileInfo {
  id: string
  name: string
  createdAt: number
  /** Optional profile picture (data URL). */
  picture?: string
  /** The built-in profile cannot be renamed or deleted. */
  isDefault?: boolean
}

/** Profiles plus the profile of the window (or settings page) asking. */
export interface ProfilesState {
  profiles: ProfileInfo[]
  activeProfileId: string
}

export interface CreateProfileInput {
  name: string
  picture?: string | null
}

export interface RenameProfileInput {
  id: string
  name: string
  picture?: string | null
}
