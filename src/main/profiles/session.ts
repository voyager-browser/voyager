import { session, type Session } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { ProfilesState } from '../../shared/profiles'
import { attachContentBlocking, primeContentBlocking } from '../contentBlocking/contentBlocking'
import { attachDownloadsTracking } from '../downloads/downloads'
import { attachPermissionHandlers } from '../permissions/permissions'
import { registerVoyagerProtocol } from '../protocol/voyagerProtocol'
import { applyProxyForProfile } from '../proxy/proxy'
import { getSettings } from '../store'
import {
  sendToSettingsWindow,
  sendToSettingsWindowAlways,
  settingsTargetProfileId
} from '../window/settingsWindow'
import { allWindows } from '../window/windowRegistry'
import { listProfiles, profilePartition } from './profiles'

const attachedSessions = new WeakSet<Session>()

/** Electron session backing a profile (default session for the built-in one). */
export function sessionForProfile(profileId: string): Session {
  const partition = profilePartition(profileId)
  return partition ? session.fromPartition(partition) : session.defaultSession
}

/** Send a profile-scoped event to that profile's windows and settings page. */
export function broadcastToProfile(profileId: string, channel: string, payload?: unknown): void {
  for (const window of allWindows()) {
    if (window.profile === profileId) window.sendToChrome(channel, payload)
  }
  sendToSettingsWindow(profileId, channel, payload)
}

/** Send an app-wide event to every browser and settings window. */
export function broadcastToAll(channel: string, payload?: unknown): void {
  for (const window of allWindows()) window.sendToChrome(channel, payload)
  sendToSettingsWindowAlways(channel, payload)
}

/** Push the profile registry to every window, with that window's active id. */
export function broadcastProfiles(): void {
  const profiles = listProfiles()
  for (const window of allWindows()) {
    const state: ProfilesState = { profiles, activeProfileId: window.profile }
    window.sendToChrome(IpcChannels.ProfilesStateChanged, state)
  }
  const settingsProfile = settingsTargetProfileId()
  if (settingsProfile) {
    sendToSettingsWindowAlways(IpcChannels.ProfilesStateChanged, {
      profiles,
      activeProfileId: settingsProfile
    } satisfies ProfilesState)
  }
}

/**
 * Attach protocol, permission, download and content-blocking integrations to a
 * profile's session exactly once. Named profiles get a persistent partition;
 * the default profile uses Electron's default session.
 */
export function ensureProfileSession(profileId: string): Session {
  const ses = sessionForProfile(profileId)
  if (attachedSessions.has(ses)) return ses
  attachedSessions.add(ses)

  registerVoyagerProtocol(ses.protocol)
  attachPermissionHandlers(ses, profileId)
  void applyProxyForProfile(ses, profileId)
  if (getSettings(profileId, 'contentBlocking', false) === true) {
    primeContentBlocking(profileId)
  }
  attachContentBlocking(ses, profileId)
  attachDownloadsTracking(ses, profileId, (state) =>
    broadcastToProfile(profileId, IpcChannels.DownloadsStateChanged, state)
  )
  return ses
}
