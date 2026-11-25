import type { BrowserState, TabState } from '../../shared/types'
import type { ExtensionTab, ExtensionTabsQueryInfo } from '../../shared/extensionTabs'
import type { WindowController } from '../window/WindowController'
import { activeWindow, allWindows } from '../window/windowRegistry'
import { markTabAccessed, pruneTabMetadata, tabMetadata, tabMutedInfo } from './tabMetadata'

export interface ExtensionTabEntry {
  window: WindowController
  state: BrowserState
  tab: TabState
  internalId: string
  webContentsId: number
}

export interface MutableExtensionTabEntry extends ExtensionTabEntry {
  webContentsId: number
}

export function entriesForWindow(
  owner: WindowController,
  state: BrowserState
): MutableExtensionTabEntry[] {
  return state.tabs
    .map((tab) => ({
      window: owner,
      state,
      tab,
      internalId: tab.id,
      webContentsId: owner.tabs.webContentsIdForTab(tab.id)
    }))
    .filter((entry): entry is MutableExtensionTabEntry => entry.webContentsId !== null)
}

/** Every tab in the profile that has a live tab webContents. */
export function extensionTabEntries(profileId: string): MutableExtensionTabEntry[] {
  const entries = allWindows()
    .filter((window) => window.profile === profileId && !window.window.isDestroyed())
    .flatMap((window) => {
      const state = window.tabs.snapshot()
      return entriesForWindow(window, state)
    })
  pruneTabMetadata(new Set(entries.map((entry) => entry.webContentsId)))
  return entries
}

/** Chrome uses -2 for "current window"; Voyager maps that to the sender's owner. */
export function extensionWindowId(
  owner: WindowController | null,
  requested?: number
): number | null {
  if (requested === undefined || requested === -2) return owner?.window.id ?? null
  if (requested === -1) return null
  return requested
}

export function asExtensionTab(entry: ExtensionTabEntry): ExtensionTab {
  const index = entry.state.tabs.findIndex((tab) => tab.id === entry.internalId)
  const active = entry.state.activeTabId === entry.internalId
  const metadata = tabMetadata(entry.webContentsId)
  if (active) markTabAccessed(entry.webContentsId)
  return {
    id: entry.webContentsId,
    index: Math.max(index, 0),
    windowId: entry.window.window.id ?? 0,
    active,
    pinned: entry.tab.pinned,
    muted: entry.tab.muted,
    mutedInfo: tabMutedInfo(entry.webContentsId, entry.tab.muted),
    highlighted: active,
    selected: active,
    discarded: entry.tab.discarded === true,
    autoDiscardable: metadata.autoDiscardable ?? true,
    audible: entry.tab.hasAudio === true,
    frozen: metadata.frozen ?? false,
    incognito: entry.window.isIncognito,
    groupId: metadata.groupId ?? -1,
    splitViewId: metadata.splitViewId ?? -1,
    status: entry.tab.discarded === true ? 'unloaded' : entry.tab.loading ? 'loading' : 'complete',
    url: entry.tab.url || undefined,
    title: entry.tab.title || undefined,
    favIconUrl: entry.tab.favicon ?? undefined,
    sessionId: `tab:${entry.webContentsId}`,
    ...metadata
  }
}

function extensionTabMatches(value: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  if (Array.isArray(expected)) return expected.includes(value)
  return expected === value
}

function extensionPatternMatches(value: string | undefined, expected: string | string[]): boolean {
  if (value === undefined) return false
  const patterns = Array.isArray(expected) ? expected : [expected]
  return patterns.some((pattern) => {
    if (pattern === '<all_urls>' || value === pattern) return true
    const expression = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${expression}$`).test(value)
  })
}

export function queryExtensionTabs(
  entries: ExtensionTabEntry[],
  query: ExtensionTabsQueryInfo | undefined,
  owner: WindowController | null
): ExtensionTabEntry[] {
  if (!query) return entries
  const requestedWindowId = extensionWindowId(owner, query.windowId)
  const focused = activeWindow() ?? owner
  return entries.filter((entry) => {
    const tab = asExtensionTab(entry)
    if (!extensionTabMatches(tab.active, query.active)) return false
    if (!extensionTabMatches(tab.audible, query.audible)) return false
    if (!extensionTabMatches(tab.autoDiscardable, query.autoDiscardable)) return false
    if (!extensionTabMatches(tab.discarded, query.discarded)) return false
    if (!extensionTabMatches(tab.frozen, query.frozen)) return false
    if (!extensionTabMatches(tab.groupId, query.groupId)) return false
    if (!extensionTabMatches(tab.highlighted, query.highlighted)) return false
    if (!extensionTabMatches(tab.muted, query.muted)) return false
    if (!extensionTabMatches(tab.pinned, query.pinned)) return false
    if (!extensionTabMatches(tab.selected, query.selected)) return false
    if (!extensionTabMatches(tab.splitViewId, query.splitViewId)) return false
    if (!extensionTabMatches(tab.status, query.status)) return false
    if (!extensionTabMatches(tab.index, query.index)) return false
    if (query.windowId !== undefined && tab.windowId !== requestedWindowId) return false
    if (query.currentWindow === true && entry.window !== owner) return false
    if (query.lastFocusedWindow === true && entry.window !== focused) return false
    if (query.windowType !== undefined && !extensionTabMatches('normal', query.windowType)) {
      return false
    }
    if (query.url !== undefined && !extensionPatternMatches(tab.url, query.url)) return false
    if (query.title !== undefined && !extensionPatternMatches(tab.title, query.title)) {
      return false
    }
    return true
  })
}
