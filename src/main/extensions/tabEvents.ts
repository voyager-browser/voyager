import {
  webContents as electronWebContents,
  type ServiceWorkerMain,
  type WebContents
} from 'electron'
import type { BrowserState } from '../../shared/types'
import type { ExtensionTab } from '../../shared/extensionTabs'
import type {
  ExtensionTabActiveInfo,
  ExtensionTabChangeInfo,
  ExtensionTabHighlightInfo,
  ExtensionTabMoveInfo,
  ExtensionTabRemoveInfo,
  ExtensionTabWindowInfo,
  ExtensionTabZoomChangeInfo,
  ExtensionTabsEventName
} from '../../shared/extensionTabEvents'
import { IpcChannels } from '../../shared/ipc-channels'
import { sessionForProfile } from '../profiles/session'
import type { WindowController } from '../window/WindowController'
import { extensionCanAccessSite } from './siteAccess'
import { asExtensionTab, entriesForWindow, type ExtensionTabEntry } from './tabProjection'
import { getZoomSettings } from './tabMetadata'

interface Snapshot {
  tabs: ExtensionTab[]
  activeTabId: string | null
}

interface BroadcastOptions {
  tabUrl?: string
  tabIndexes?: number[]
  changeInfoIndex?: number
}

const snapshots = new WeakMap<WindowController, Snapshot>()

const SENSITIVE_TAB_KEYS = ['url', 'pendingUrl', 'title', 'favIconUrl'] as const
const SENSITIVE_CHANGE_KEYS = ['url', 'title', 'favIconUrl'] as const

function extensionIdFromUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'chrome-extension:' ? url.host : null
  } catch {
    return null
  }
}

function isExtensionUrl(value: string): boolean {
  return extensionIdFromUrl(value) !== null
}

function knownExtension(profileId: string, extensionId: string | null): boolean {
  if (!extensionId) return false
  return sessionForProfile(profileId)
    .extensions.getAllExtensions()
    .some((extension) => extension.id === extensionId)
}

function sanitizeArgs(
  args: unknown[],
  profileId: string,
  extensionId: string,
  options: BroadcastOptions
): unknown[] {
  if (!options.tabUrl) return args
  if (extensionCanAccessSite(profileId, extensionId, options.tabUrl)) return args
  const cloned = args.map((value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : value
  )
  for (const index of options.tabIndexes ?? []) {
    const value = cloned[index]
    if (!value || typeof value !== 'object') continue
    for (const key of SENSITIVE_TAB_KEYS) delete (value as Record<string, unknown>)[key]
  }
  if (options.changeInfoIndex !== undefined) {
    const changeInfo = cloned[options.changeInfoIndex]
    if (changeInfo && typeof changeInfo === 'object') {
      for (const key of SENSITIVE_CHANGE_KEYS) delete (changeInfo as Record<string, unknown>)[key]
    }
  }
  return cloned
}

/** Deliver a tab event to extension pages and service workers in this profile. */
export function emitTabsEvent(
  profileId: string,
  event: ExtensionTabsEventName,
  args: unknown[],
  options: BroadcastOptions = {}
): void {
  const send = (target: WebContents | ServiceWorkerMain, extensionId: string): void => {
    if (target.isDestroyed()) return
    target.send(IpcChannels.ExtensionTabsEvent, {
      event,
      args: sanitizeArgs(args, profileId, extensionId, options)
    })
  }

  for (const target of electronWebContents.getAllWebContents()) {
    if (target.isDestroyed() || target.session !== sessionForProfile(profileId)) continue
    const url = target.getURL()
    if (!isExtensionUrl(url)) continue
    const extensionId = extensionIdFromUrl(url)
    if (!knownExtension(profileId, extensionId)) continue
    send(target, extensionId as string)
  }

  const session = sessionForProfile(profileId)
  const running = session.serviceWorkers.getAllRunning()
  for (const versionId of Object.keys(running)) {
    const scope = running[Number(versionId)].scope
    if (!isExtensionUrl(scope)) continue
    const worker = session.serviceWorkers.getWorkerFromVersionID(Number(versionId))
    const extensionId = extensionIdFromUrl(scope)
    if (!worker || !knownExtension(profileId, extensionId)) continue
    send(worker, extensionId as string)
  }
}

function changeInfoFor(previous: ExtensionTab, current: ExtensionTab): ExtensionTabChangeInfo {
  const change: ExtensionTabChangeInfo = {}
  if (previous.status !== current.status) change.status = current.status
  if (previous.title !== current.title) change.title = current.title
  if (previous.url !== current.url) change.url = current.url
  if (previous.favIconUrl !== current.favIconUrl) change.favIconUrl = current.favIconUrl
  if (previous.pinned !== current.pinned) change.pinned = current.pinned
  if (previous.mutedInfo.muted !== current.mutedInfo.muted) {
    change.mutedInfo = current.mutedInfo
  }
  if (previous.discarded !== current.discarded) change.discarded = current.discarded
  if (previous.audible !== current.audible) change.audible = current.audible
  if (previous.autoDiscardable !== current.autoDiscardable) {
    change.autoDiscardable = current.autoDiscardable
  }
  if (previous.frozen !== current.frozen) change.frozen = current.frozen
  if (previous.groupId !== current.groupId) change.groupId = current.groupId
  if (previous.splitViewId !== current.splitViewId) change.splitViewId = current.splitViewId
  return change
}

export function emitTabUpdated(
  profileId: string,
  entry: ExtensionTabEntry,
  changeInfo: ExtensionTabChangeInfo
): void {
  if (Object.keys(changeInfo).length === 0) return
  const tab = asExtensionTab(entry)
  emitTabsEvent(profileId, 'onUpdated', [entry.webContentsId, changeInfo, tab], {
    tabUrl: tab.url,
    tabIndexes: [2],
    changeInfoIndex: 1
  })
}

/** Diff one window's tab state and emit the corresponding chrome.tabs events. */
export function publishExtensionTabState(
  profileId: string,
  owner: WindowController,
  state: BrowserState
): void {
  const previous = snapshots.get(owner)
  const entries = entriesForWindow(owner, state)
  const currentTabs = entries.map(asExtensionTab)
  const currentById = new Map(currentTabs.map((tab) => [String(tab.id), tab]))
  const previousById = new Map((previous?.tabs ?? []).map((tab) => [String(tab.id), tab]))

  for (const [id, tab] of previousById) {
    if (currentById.has(id)) continue
    const info: ExtensionTabRemoveInfo = {
      windowId: tab.windowId,
      isWindowClosing: owner.window.isDestroyed()
    }
    emitTabsEvent(profileId, 'onRemoved', [tab.id, info])
  }

  for (const tab of currentTabs) {
    const id = String(tab.id)
    const older = previousById.get(id)
    if (!older) {
      emitTabsEvent(profileId, 'onCreated', [tab], { tabUrl: tab.url, tabIndexes: [0] })
      continue
    }

    if (older.windowId !== tab.windowId) {
      const detach: ExtensionTabWindowInfo = {
        windowId: older.windowId,
        position: older.index
      }
      const attach: ExtensionTabWindowInfo = { windowId: tab.windowId, position: tab.index }
      emitTabsEvent(profileId, 'onDetached', [tab.id, detach])
      emitTabsEvent(profileId, 'onAttached', [tab.id, attach])
    } else if (older.index !== tab.index) {
      const info: ExtensionTabMoveInfo = {
        windowId: tab.windowId,
        oldWindowId: older.windowId,
        index: tab.index,
        oldIndex: older.index
      }
      emitTabsEvent(profileId, 'onMoved', [tab.id, info])
    }

    const change = changeInfoFor(older, tab)
    if (Object.keys(change).length > 0) {
      emitTabsEvent(profileId, 'onUpdated', [tab.id, change, tab], {
        tabUrl: tab.url ?? older.url,
        tabIndexes: [2],
        changeInfoIndex: 1
      })
    }
  }

  const active = state.tabs.find((tab) => tab.id === state.activeTabId)
  if (active && active.id !== previous?.activeTabId) {
    const activeWebContentsId = owner.tabs.webContentsIdForTab(active.id)
    const activeTab = currentTabs.find((tab) => tab.id === activeWebContentsId)
    if (activeTab) {
      const info: ExtensionTabActiveInfo = {
        tabId: activeTab.id,
        windowId: activeTab.windowId
      }
      const highlight: ExtensionTabHighlightInfo = {
        windowId: activeTab.windowId,
        tabIds: [activeTab.id]
      }
      emitTabsEvent(profileId, 'onActivated', [info])
      emitTabsEvent(profileId, 'onHighlighted', [highlight])
    }
  }

  snapshots.set(owner, {
    tabs: currentTabs,
    activeTabId: state.activeTabId
  })
}

export function emitZoomChange(
  profileId: string,
  tabId: number,
  oldZoomFactor: number,
  newZoomFactor: number
): void {
  const settings = getZoomSettings(tabId)
  const info: ExtensionTabZoomChangeInfo = {
    tabId,
    oldZoomFactor,
    newZoomFactor,
    zoomSettings: {
      ...settings,
      defaultZoomFactor: settings.defaultZoomFactor ?? 1,
      mode: settings.mode ?? 'automatic',
      scope: settings.scope ?? 'per-origin'
    }
  }
  emitTabsEvent(profileId, 'onZoomChange', [info])
}
