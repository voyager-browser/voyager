import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_PROFILE_ID,
  PROFILE_COLORS,
  isProfileColor,
  type CreateProfileInput,
  type ProfileInfo,
  type RenameProfileInput
} from '../../shared/profiles'
import { dropProfileStores, profileDataDir } from '../store'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'

interface ProfilesRegistry {
  profiles: ProfileInfo[]
  lastProfileId: string
}

const REGISTRY_FILE = 'profiles.json'
const PARTITION_PREFIX = 'persist:voyager-profile-'

let cached: ProfilesRegistry | null = null

function registryPath(): string {
  return join(app.getPath('userData'), REGISTRY_FILE)
}

function builtinProfile(): ProfileInfo {
  return { id: DEFAULT_PROFILE_ID, name: 'Default', color: 'blue', createdAt: 0, isDefault: true }
}

function normalizePicture(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('data:image/')) return undefined
  return trimmed
}

function normalizeBackgroundColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64) return undefined
  // allow hex/rgb/hsl and simple named colors; reject obvious injection
  if (!/^(#[0-9a-fA-F]{3,8}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|[a-zA-Z]{1,32})$/.test(trimmed)) return undefined
  return trimmed
}

function normalizeProfile(value: unknown): ProfileInfo | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ProfileInfo> & Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') return null
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') return null
  const picture = normalizePicture(candidate.picture)
  const backgroundColor = normalizeBackgroundColor(candidate.backgroundColor)
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    color: isProfileColor(candidate.color) ? candidate.color : 'blue',
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    ...(picture ? { picture } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(candidate.id === DEFAULT_PROFILE_ID ? { isDefault: true } : {})
  }
}

function readRegistry(): ProfilesRegistry {
  const raw = readJsonFile<Partial<ProfilesRegistry>>(registryPath(), {})
  const seen = new Set<string>()
  const profiles: ProfileInfo[] = []
  for (const value of Array.isArray(raw.profiles) ? raw.profiles : []) {
    const profile = normalizeProfile(value)
    if (!profile || seen.has(profile.id)) continue
    seen.add(profile.id)
    profiles.push(profile)
  }
  if (!seen.has(DEFAULT_PROFILE_ID)) profiles.unshift(builtinProfile())
  const lastProfileId =
    typeof raw.lastProfileId === 'string' &&
    profiles.some((profile) => profile.id === raw.lastProfileId)
      ? raw.lastProfileId
      : DEFAULT_PROFILE_ID
  return { profiles, lastProfileId }
}

function registry(): ProfilesRegistry {
  if (!cached) cached = readRegistry()
  return cached
}

function persist(): void {
  if (cached) writeJsonFile(registryPath(), cached)
}

/** Every profile, in creation order with the built-in profile first. */
export function listProfiles(): ProfileInfo[] {
  return registry().profiles.map((profile) => ({ ...profile }))
}

export function profileById(id: string): ProfileInfo | undefined {
  const profile = registry().profiles.find((candidate) => candidate.id === id)
  return profile ? { ...profile } : undefined
}

/** Profile new windows should open with when no other profile is specified. */
export function lastProfileId(): string {
  return registry().lastProfileId
}

export function setLastProfileId(id: string): void {
  if (!profileById(id)) return
  registry().lastProfileId = id
  persist()
}

/**
 * Session partition for a profile. The default profile deliberately uses
 * `null` (Electron's default persistent session) so existing cookies and
 * storage continue to work after upgrading.
 */
export function profilePartition(id: string): string | null {
  return id === DEFAULT_PROFILE_ID ? null : `${PARTITION_PREFIX}${id}`
}

function assertUniqueName(name: string, exceptId?: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Profile name cannot be empty')
  const clash = registry().profiles.some(
    (profile) => profile.id !== exceptId && profile.name.toLowerCase() === trimmed.toLowerCase()
  )
  if (clash) throw new Error(`A profile named "${trimmed}" already exists`)
  return trimmed
}

/** Create a profile with its own data directory and return it. */
export function createProfile(input: CreateProfileInput): ProfileInfo {
  const name = assertUniqueName(input.name)
  const id = randomUUID()
  const color = isProfileColor(input.color)
    ? input.color
    : PROFILE_COLORS[registry().profiles.length % PROFILE_COLORS.length]
  const picture = normalizePicture(input.picture)
  const backgroundColor = normalizeBackgroundColor(input.backgroundColor)
  const profile: ProfileInfo = {
    id,
    name,
    color,
    createdAt: Date.now(),
    ...(picture ? { picture } : {}),
    ...(backgroundColor ? { backgroundColor } : {})
  }
  mkdirSync(profileDataDir(id), { recursive: true })
  registry().profiles.push(profile)
  persist()
  return { ...profile }
}

/** Rename/recolor a profile. The built-in profile can be renamed but not removed. */
export function updateProfile(input: RenameProfileInput): ProfileInfo {
  const profile = registry().profiles.find((candidate) => candidate.id === input.id)
  if (!profile) throw new Error('Profile not found')
  profile.name = assertUniqueName(input.name, input.id)
  if (isProfileColor(input.color)) profile.color = input.color
  if (input.picture !== undefined) {
    const picture = normalizePicture(input.picture)
    if (picture) profile.picture = picture
    else delete profile.picture
  }
  if (input.backgroundColor !== undefined) {
    const backgroundColor = normalizeBackgroundColor(input.backgroundColor)
    if (backgroundColor) profile.backgroundColor = backgroundColor
    else delete profile.backgroundColor
  }
  persist()
  return { ...profile }
}

/**
 * Delete a profile and its data directory. The built-in profile is protected.
 * Callers are responsible for closing windows that use the profile first.
 */
export function deleteProfile(id: string): void {
  if (id === DEFAULT_PROFILE_ID) throw new Error('The default profile cannot be deleted')
  const index = registry().profiles.findIndex((profile) => profile.id === id)
  if (index === -1) throw new Error('Profile not found')
  registry().profiles.splice(index, 1)
  if (registry().lastProfileId === id) registry().lastProfileId = DEFAULT_PROFILE_ID
  persist()
  dropProfileStores(id)
  rmSync(profileDataDir(id), { recursive: true, force: true })
}
