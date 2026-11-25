import { session, type Session } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { ProfilesState } from '../../shared/profiles'
import type { DownloadsState } from '../../shared/types'
import { attachContentBlocking, primeContentBlocking } from '../contentBlocking/contentBlocking'
import { attachDownloadsTracking } from '../downloads/downloads'
import {
  attachPermissionHandlers,
  autoRemoveStalePermissions,
  currentSitePermissions
} from '../permissions/permissions'
import { registerVoyagerProtocol } from '../protocol/voyagerProtocol'
import { applyProxyForProfile } from '../proxy/proxy'
import { applyUserAgentForProfile } from '../userAgent/userAgent'
import { runTopSitesPreload } from '../preload/preloadTopSites'
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

interface SessionSetupOptions {
  /** Incognito sessions keep decisions and downloads in memory instead. */
  persist?: boolean
  /** Incognito downloads report only to the window that started them. */
  onDownloadsState?: (state: DownloadsState) => void
  /** Isolated blocking-counter key; incognito windows use their partition. */
  statsKey?: string
}

/**
 * Apply the owning profile's session policies exactly once. Normal sessions
 * use persisted stores; incognito sessions share the same integrations but
 * keep their state in memory for the lifetime of the partition.
 */
function attachSessionPolicies(
  ses: Session,
  profileId: string,
  options: SessionSetupOptions = {}
): void {
  if (attachedSessions.has(ses)) return
  attachedSessions.add(ses)
  const persist = options.persist !== false

  registerVoyagerProtocol(ses.protocol)
  attachPermissionHandlers(ses, profileId, { persist })
  if (persist && autoRemoveStalePermissions(profileId)) {
    broadcastToProfile(
      profileId,
      IpcChannels.PermissionsStateChanged,
      currentSitePermissions(profileId)
    )
  }
  void applyProxyForProfile(ses, profileId)
  applyUserAgentForProfile(ses, profileId)
  ses.setSpellCheckerEnabled(getSettings(profileId, 'spellcheck', true) !== false)
  if (getSettings(profileId, 'contentBlocking', false) === true) {
    primeContentBlocking(profileId)
  }
  attachContentBlocking(ses, profileId, { statsKey: options.statsKey })
  attachDownloadsTracking(
    ses,
    profileId,
    options.onDownloadsState ??
      ((state) => broadcastToProfile(profileId, IpcChannels.DownloadsStateChanged, state)),
    { persist }
  )
  void runTopSitesPreload(ses, profileId)
}

/**
 * Attach protocol, permission, download and content-blocking integrations to a
 * profile's session exactly once. Named profiles get a persistent partition;
 * the default profile uses Electron's default session.
 */
export function ensureProfileSession(profileId: string): Session {
  const ses = sessionForProfile(profileId)
  attachSessionPolicies(ses, profileId)
  return ses
}

/**
 * Give an incognito partition its owner's network and content policies. The
 * session itself is in-memory (no `persist:` prefix), and the setup guard makes
 * repeated toggles safe instead of registering handlers twice.
 */
export function configureIncognitoSession(
  ses: Session,
  profileId: string,
  onDownloadsState?: (state: DownloadsState) => void,
  statsKey?: string
): Session {
  attachSessionPolicies(ses, profileId, { persist: false, onDownloadsState, statsKey })
  return ses
}
