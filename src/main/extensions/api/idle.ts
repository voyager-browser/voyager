import {
  app,
  powerMonitor,
  webContents as electronWebContents,
  type Session,
  type WebContents
} from 'electron'
import { sessionForProfile } from '../../profiles/session'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'

type IdleStateName = 'active' | 'idle' | 'locked'

interface ProfileIdleState {
  status: IdleStateName
  lastInputAt: number
  intervalMs: number
}

const DEFAULT_INTERVAL_SECONDS = 60
const MIN_INTERVAL_SECONDS = 15
const LOCK_MULTIPLIER = 5

const states = new Map<string, ProfileIdleState>()
const trackedSessions = new WeakMap<Session, string>()
const watched = new WeakSet<WebContents>()
let appListenerAttached = false
let powerListenersAttached = false
let tickTimer: NodeJS.Timeout | null = null

const intervalKey = (profileId: string): string => `idle:detectionInterval:${profileId}`

function readInterval(profileId: string): number {
  const stored = getApiSetting<unknown>(profileId, intervalKey(profileId), DEFAULT_INTERVAL_SECONDS)
  const seconds = typeof stored === 'number' ? stored : Number.NaN
  return Number.isFinite(seconds)
    ? Math.max(MIN_INTERVAL_SECONDS, Math.floor(seconds))
    : DEFAULT_INTERVAL_SECONDS
}

function stateFor(profileId: string): ProfileIdleState {
  let state = states.get(profileId)
  if (!state) {
    state = {
      status: 'active',
      lastInputAt: Date.now(),
      intervalMs: readInterval(profileId) * 1000
    }
    states.set(profileId, state)
    ensureTimer()
  }
  return state
}

function transition(profileId: string, state: ProfileIdleState, next: IdleStateName): void {
  if (state.status === next) return
  state.status = next
  broadcastExtensionApiEvent(
    profileId,
    { path: ['idle'], event: 'onStateChanged', args: [next] },
    'idle'
  )
}

function refresh(profileId: string, state: ProfileIdleState): void {
  const elapsed = Date.now() - state.lastInputAt
  const next: IdleStateName =
    elapsed >= state.intervalMs * LOCK_MULTIPLIER
      ? 'locked'
      : elapsed >= state.intervalMs
        ? 'idle'
        : 'active'
  transition(profileId, state, next)
}

function ensureTimer(): void {
  if (tickTimer) return
  tickTimer = setInterval(() => {
    for (const [profileId, state] of states) refresh(profileId, state)
  }, 1000)
  tickTimer.unref()
}

function noteInput(profileId: string): void {
  const state = stateFor(profileId)
  state.lastInputAt = Date.now()
  transition(profileId, state, 'active')
}

function attachPowerMonitor(): void {
  if (powerListenersAttached) return
  powerListenersAttached = true
  try {
    powerMonitor.on('lock-screen', () => {
      for (const [profileId, state] of states) transition(profileId, state, 'locked')
    })
    powerMonitor.on('unlock-screen', () => {
      for (const profileId of states.keys()) noteInput(profileId)
    })
  } catch {
    // Screen-lock notifications are not available on every platform.
  }
}

function watchInput(contents: WebContents, profileId: string): void {
  if (watched.has(contents)) return
  watched.add(contents)
  contents.on('before-input-event', (_event, _input) => noteInput(profileId))
}

/**
 * Track input for a profile session so Chrome's idle API can report active,
 * idle and locked states. Call from the profile session setup where available;
 * API calls also attach lazily as a fallback.
 */
export function attachIdleTracking(ses: Session, profileId: string): void {
  if (trackedSessions.has(ses)) return
  trackedSessions.set(ses, profileId)
  stateFor(profileId)

  for (const contents of electronWebContents.getAllWebContents()) {
    if (contents.session === ses) watchInput(contents, profileId)
  }
  if (!appListenerAttached) {
    appListenerAttached = true
    app.on('web-contents-created', (_event, contents) => {
      const owner = trackedSessions.get(contents.session)
      if (owner) watchInput(contents, owner)
    })
  }
  attachPowerMonitor()
}

export function registerIdle(): void {
  registerExtensionApiHandler('idle', {
    permissions: ['idle'],
    invoke(context, method, args): unknown {
      attachIdleTracking(sessionForProfile(context.profileId), context.profileId)
      const state = stateFor(context.profileId)

      if (method === 'setDetectionInterval') {
        const raw = args[0]
        const seconds = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
        state.intervalMs =
          Math.max(
            MIN_INTERVAL_SECONDS,
            Number.isFinite(seconds) ? Math.floor(seconds) : DEFAULT_INTERVAL_SECONDS
          ) * 1000
        setApiSetting(context.profileId, intervalKey(context.profileId), state.intervalMs / 1000)
        refresh(context.profileId, state)
        return undefined
      }

      if (method === 'getState' || method === 'queryState') return state.status

      throw new Error(`chrome.idle.${method} is not supported.`)
    }
  })
}
