import { hostname } from 'node:os'
import type { TabState } from '../../../shared/types'
import type { SessionTabRecord } from '../../store/session'
import { storesFor } from '../../store'
import { createWindow } from '../../window/createWindow'
import type { WindowController } from '../../window/WindowController'
import { activeWindow, allWindows } from '../../window/windowRegistry'
import { registerExtensionApiHandler } from './registry'

const PATH = 'sessions'

interface ChromeSessionTab {
  url: string
  title?: string
  favIconUrl?: string
  index: number
  pinned?: boolean
  active?: boolean
}

interface ChromeSessionWindow {
  focused: boolean
  incognito?: boolean
  tabs: ChromeSessionTab[]
}

interface ChromeSession {
  sessionId: string
  lastModified: number
  browser: { windows: ChromeSessionWindow[] }
  tab?: ChromeSessionTab
  window?: ChromeSessionWindow
  deviceInfo?: { deviceName: string }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function windowsFor(profileId: string): WindowController[] {
  return allWindows().filter(
    (controller) => controller.profile === profileId && !controller.window.isDestroyed()
  )
}

function chromeTabFromState(
  tab: TabState,
  index: number,
  activeId: string | null
): ChromeSessionTab {
  return {
    url: tab.url,
    ...(tab.title ? { title: tab.title } : {}),
    ...(tab.favicon ? { favIconUrl: tab.favicon } : {}),
    index,
    pinned: tab.pinned,
    active: tab.id === activeId
  }
}

function chromeTabFromRecord(tab: SessionTabRecord, index: number): ChromeSessionTab {
  return {
    url: tab.url,
    ...(tab.title ? { title: tab.title } : {}),
    index,
    pinned: tab.pinned,
    active: index === 0
  }
}

function chromeWindow(controller: WindowController): ChromeSessionWindow {
  const state = controller.tabs.snapshot()
  return {
    focused: activeWindow() === controller,
    incognito: controller.isIncognito,
    tabs: state.tabs.map((tab, index) => chromeTabFromState(tab, index, state.activeTabId))
  }
}

function savedTabs(profileId: string): SessionTabRecord[] {
  return storesFor(profileId).session.snapshot.tabs.filter(
    (tab) => typeof tab.url === 'string' && tab.url.length > 0
  )
}

function makeSession(
  sessionId: string,
  windows: ChromeSessionWindow[],
  extra: Partial<Pick<ChromeSession, 'tab' | 'window' | 'deviceInfo'>> = {}
): ChromeSession {
  return {
    sessionId,
    lastModified: Date.now(),
    browser: { windows },
    ...extra
  }
}

function closedTabSession(
  profileId: string,
  controller: WindowController,
  index: number,
  entry: { url: string; title: string },
  sessionId = `closed:${profileId}:${index}:${entry.url}`
): ChromeSession {
  const tab: ChromeSessionTab = {
    url: entry.url,
    ...(entry.title ? { title: entry.title } : {}),
    index: 0,
    pinned: false,
    active: true
  }
  const window: ChromeSessionWindow = {
    focused: activeWindow() === controller,
    incognito: controller.isIncognito,
    tabs: [tab]
  }
  return makeSession(sessionId, [window], { tab, window })
}

function maxResultsFrom(args: unknown[]): number {
  const first = args[0]
  const options = record(first)
  const requested =
    typeof first === 'number'
      ? first
      : typeof options.maxResults === 'number'
        ? options.maxResults
        : 20
  return Math.max(0, Math.min(100, Math.floor(requested)))
}

function recentlyClosed(profileId: string, args: unknown[]): ChromeSession[] {
  const limit = maxResultsFrom(args)
  const sessions: ChromeSession[] = []
  for (const controller of windowsFor(profileId)) {
    const closed = controller.tabs.getClosedTabs()
    // TabManager stores oldest first; Chrome reports the most recent first.
    for (let index = closed.length - 1; index >= 0 && sessions.length < limit; index -= 1) {
      sessions.push(closedTabSession(profileId, controller, index, closed[index]))
    }
  }
  if (sessions.length < limit) {
    const tabs = savedTabs(profileId)
    if (tabs.length > 0) {
      const window: ChromeSessionWindow = {
        focused: false,
        incognito: false,
        tabs: tabs.map(chromeTabFromRecord)
      }
      sessions.push(makeSession(`saved:${profileId}`, [window], { window }))
    }
  }
  return sessions.slice(0, limit)
}

function deviceSessions(profileId: string): ChromeSession[] {
  const windows = windowsFor(profileId).map(chromeWindow)
  if (windows.length === 0) {
    const tabs = savedTabs(profileId)
    if (tabs.length > 0) {
      windows.push({
        focused: false,
        incognito: false,
        tabs: tabs.map(chromeTabFromRecord)
      })
    }
  }
  return [
    makeSession(`device:${profileId}`, windows, {
      deviceInfo: { deviceName: hostname() }
    })
  ]
}

function openSavedTabs(profileId: string, tabs: SessionTabRecord[]): WindowController {
  const [first, ...rest] = tabs
  const controller = createWindow({ profileId, url: first?.url })
  for (const tab of rest) {
    const id = controller.tabs.create({ url: tab.url, active: false })
    if (tab.pinned) controller.tabs.pinToggle(id)
  }
  if (first?.pinned && controller.tabs.activeTabId) {
    controller.tabs.pinToggle(controller.tabs.activeTabId)
  }
  return controller
}

function sessionIdParts(sessionId: string): { profileId: string; index: number } | null {
  const parts = sessionId.split(':')
  if (parts.length < 3) return null
  const index = Number(parts[2])
  return Number.isFinite(index)
    ? { profileId: parts[1], index: Math.max(0, Math.floor(index)) }
    : null
}

function restoreSession(profileId: string, sessionId?: string): ChromeSession {
  if (typeof sessionId === 'string' && sessionId.startsWith('closed:')) {
    const parsed = sessionIdParts(sessionId)
    if (parsed && parsed.profileId === profileId) {
      for (const controller of windowsFor(profileId)) {
        const closed = controller.tabs.getClosedTabs()
        const entry = closed[parsed.index]
        if (!entry) continue
        controller.tabs.reopenClosedTab(parsed.index)
        return closedTabSession(profileId, controller, parsed.index, entry, sessionId)
      }
    }
  }

  if (typeof sessionId === 'string' && sessionId.startsWith('window:')) {
    const parsed = sessionIdParts(sessionId)
    if (parsed && parsed.profileId === profileId) {
      const controller = windowsFor(profileId)[parsed.index]
      if (controller) {
        const state = controller.tabs.snapshot()
        const tabs: SessionTabRecord[] = state.tabs.map((tab) => ({
          url: tab.url,
          title: tab.title,
          pinned: tab.pinned
        }))
        const opened = openSavedTabs(profileId, tabs)
        return makeSession(sessionId, [chromeWindow(opened)])
      }
    }
  }

  const wantsSaved =
    !sessionId ||
    sessionId.startsWith('saved:') ||
    sessionId.startsWith('device:') ||
    sessionId.startsWith('closed:') ||
    sessionId.startsWith('window:')
  if (wantsSaved) {
    const tabs = savedTabs(profileId)
    if (tabs.length > 0) {
      const opened = openSavedTabs(profileId, tabs)
      return makeSession(typeof sessionId === 'string' ? sessionId : `saved:${profileId}`, [
        chromeWindow(opened)
      ])
    }
  }

  if (!sessionId) {
    for (const controller of windowsFor(profileId)) {
      const closed = controller.tabs.getClosedTabs()
      const index = closed.length - 1
      if (index < 0) continue
      const entry = closed[index]
      controller.tabs.reopenClosedTab(index)
      return closedTabSession(profileId, controller, index, entry)
    }
  }

  const opened = createWindow({ profileId })
  return makeSession(`window:${profileId}:0`, [chromeWindow(opened)])
}

export function registerSessions(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(context, method, args): unknown {
      if (method === 'getRecentlyClosed') return recentlyClosed(context.profileId, args)
      if (method === 'getSessions') return deviceSessions(context.profileId)
      if (method === 'restore') {
        const sessionId = typeof args[0] === 'string' ? args[0] : undefined
        return restoreSession(context.profileId, sessionId)
      }
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
