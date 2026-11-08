/**
 * Chrome-like profiles. Every profile owns a persistent Electron partition
 * (cookies, cache, storage) plus its own bookmarks, history, downloads, site
 * permissions and preferences. The built-in `default` profile reuses the
 * existing userData directory so current browsing data keeps working.
 */

export const DEFAULT_PROFILE_ID = 'default'

/** Avatar colors offered when creating a profile. */
export const PROFILE_COLORS = [
  'blue',
  'red',
  'yellow',
  'green',
  'purple',
  'orange',
  'pink',
  'teal'
] as const

export type ProfileColor = (typeof PROFILE_COLORS)[number]

export interface ProfileInfo {
  id: string
  name: string
  color: ProfileColor
  createdAt: number
  /** Optional profile picture (data URL). */
  picture?: string
  /** Optional custom background color (CSS color) for the avatar. */
  backgroundColor?: string
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
  color?: ProfileColor
  picture?: string | null
  backgroundColor?: string | null
}

export interface RenameProfileInput {
  id: string
  name: string
  color?: ProfileColor
  picture?: string | null
  backgroundColor?: string | null
}

export function isProfileColor(value: unknown): value is ProfileColor {
  return typeof value === 'string' && (PROFILE_COLORS as readonly string[]).includes(value)
}

/** Tailwind background classes used for profile avatars and swatches. */
export const PROFILE_COLOR_CLASSES: Record<ProfileColor, string> = {
  blue: 'bg-sky-500',
  red: 'bg-rose-500',
  yellow: 'bg-amber-500',
  green: 'bg-emerald-500',
  purple: 'bg-violet-500',
  orange: 'bg-orange-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500'
}
