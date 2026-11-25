import type {
  ExtensionMutedInfo,
  ExtensionTab,
  ExtensionZoomSettings
} from '../../shared/extensionTabs'

const autoDiscardable = new Map<number, boolean>()
const frozen = new Map<number, boolean>()
const groups = new Map<number, number>()
const splitViews = new Map<number, number>()
const openers = new Map<number, number>()
const lastAccessed = new Map<number, number>()
const zoomSettings = new Map<number, ExtensionZoomSettings>()
const mutingExtensions = new Map<number, string>()

let nextGroupId = 1
let nextSplitViewId = 1

export function pruneTabMetadata(validTabIds: ReadonlySet<number>): void {
  for (const map of [
    autoDiscardable,
    frozen,
    groups,
    splitViews,
    openers,
    lastAccessed,
    zoomSettings,
    mutingExtensions
  ]) {
    for (const key of map.keys()) {
      if (!validTabIds.has(key)) map.delete(key)
    }
  }
}

export function tabMetadata(tabId: number): Partial<ExtensionTab> {
  const metadata: Partial<ExtensionTab> = {
    autoDiscardable: autoDiscardable.get(tabId) ?? true,
    frozen: frozen.get(tabId) ?? false,
    groupId: groups.get(tabId) ?? -1,
    splitViewId: splitViews.get(tabId) ?? -1
  }
  const openerTabId = openers.get(tabId)
  if (openerTabId !== undefined) metadata.openerTabId = openerTabId
  const accessed = lastAccessed.get(tabId)
  if (accessed !== undefined) metadata.lastAccessed = accessed
  return metadata
}

export function tabMutedInfo(tabId: number, muted: boolean): ExtensionMutedInfo {
  const extensionId = mutingExtensions.get(tabId)
  return {
    muted,
    reason: muted && extensionId ? 'extension' : undefined,
    extensionId: muted ? extensionId : undefined
  }
}

export function setTabMutedBy(tabId: number, extensionId: string | null, muted: boolean): void {
  if (muted && extensionId) mutingExtensions.set(tabId, extensionId)
  else mutingExtensions.delete(tabId)
}

export function getAutoDiscardable(tabId: number): boolean {
  return autoDiscardable.get(tabId) ?? true
}

export function setAutoDiscardable(tabId: number, value: boolean): void {
  autoDiscardable.set(tabId, value)
}

export function getFrozen(tabId: number): boolean {
  return frozen.get(tabId) ?? false
}

export function setFrozen(tabId: number, value: boolean): void {
  frozen.set(tabId, value)
}

export function tabGroupId(tabId: number): number {
  return groups.get(tabId) ?? -1
}

export function groupTabs(tabIds: number[], groupId?: number): number {
  const assigned = groupId ?? nextGroupId++
  for (const tabId of tabIds) groups.set(tabId, assigned)
  return assigned
}

export function ungroupTabs(tabIds: number[]): void {
  for (const tabId of tabIds) groups.delete(tabId)
}

export function tabSplitViewId(tabId: number): number {
  return splitViews.get(tabId) ?? -1
}

export function splitTabs(tabIds: number[]): number {
  const splitViewId = nextSplitViewId++
  for (const tabId of tabIds) splitViews.set(tabId, splitViewId)
  return splitViewId
}

export function unsplitView(splitViewId: number): number[] {
  const affected: number[] = []
  for (const [tabId, current] of splitViews) {
    if (current === splitViewId) affected.push(tabId)
  }
  for (const tabId of affected) splitViews.delete(tabId)
  return affected
}

export function setTabOpener(tabId: number, openerTabId: number): void {
  openers.set(tabId, openerTabId)
}

export function markTabAccessed(tabId: number): void {
  lastAccessed.set(tabId, Date.now())
}

export function getZoomSettings(tabId: number): ExtensionZoomSettings {
  return zoomSettings.get(tabId) ?? { defaultZoomFactor: 1, mode: 'automatic', scope: 'per-origin' }
}

export function setZoomSettings(tabId: number, settings: ExtensionZoomSettings): void {
  zoomSettings.set(tabId, settings)
}
