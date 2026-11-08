import type { PermissionKind, PermissionRequestChoice } from './types'

/** Every category in the order Settings and prompts should present them. */
export const PERMISSION_KINDS: readonly PermissionKind[] = [
  'geolocation',
  'notifications',
  'camera',
  'microphone',
  'camera-microphone',
  'clipboard-read',
  'display-capture',
  'midi',
  'device-access',
  'other'
]

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  geolocation: 'Location',
  notifications: 'Notifications',
  camera: 'Camera',
  microphone: 'Microphone',
  'camera-microphone': 'Camera and microphone',
  'clipboard-read': 'Clipboard',
  'display-capture': 'Screen sharing',
  midi: 'MIDI devices',
  'device-access': 'Connected devices',
  other: 'Other permissions'
}

/** Short verb phrase shown beside the requesting site in a prompt. */
export const PERMISSION_ACTIONS: Record<PermissionKind, string> = {
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  'camera-microphone': 'Use your camera and microphone',
  'clipboard-read': 'See text and images copied to the clipboard',
  'display-capture': 'Share your screen',
  midi: 'Use your MIDI devices',
  'device-access': 'Connect to a device',
  other: 'Use this permission'
}

export function isPermissionKind(value: unknown): value is PermissionKind {
  return typeof value === 'string' && (PERMISSION_KINDS as readonly string[]).includes(value)
}

export function isPermissionRequestChoice(value: unknown): value is PermissionRequestChoice {
  return (
    value === 'allow-site' || value === 'allow-once' || value === 'block' || value === 'dismiss'
  )
}

/** Normalize a URL/origin into a site origin, rejecting opaque/file origins. */
export function permissionOriginForUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Human-readable host for an origin, used in prompts and Settings. */
export function permissionHostForOrigin(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}
