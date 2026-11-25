import { activeWindow } from '../../window/windowRegistry'
import { extensionTabEntries, entriesForWindow, type ExtensionTabEntry } from '../tabProjection'
import { groupTabs, tabGroupId } from '../tabMetadata'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'

type GroupColor =
  'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange'

interface StoredGroup {
  id: number
  title: string
  color: GroupColor
  collapsed: boolean
  windowId: number
  tabIds: number[]
}

interface ChromeTabGroup {
  id: number
  title: string
  color: GroupColor
  collapsed: boolean
  windowId: number
  tabIds: number[]
}

interface ReconciledGroups {
  groups: StoredGroup[]
  live: Map<number, ExtensionTabEntry>
}

const COLORS: readonly GroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
]

/** Profiles whose persisted group membership has been replayed into tab metadata. */
const hydrated = new Set<string>()
let seededMaxId = 0

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const keyFor = (profileId: string): string => `tabGroups:${profileId}`

const isColor = (value: unknown): value is GroupColor =>
  typeof value === 'string' && (COLORS as readonly string[]).includes(value)

function normalizeColor(value: unknown): GroupColor {
  if (value === 'gray') return 'grey'
  return isColor(value) ? value : 'grey'
}

function normalizeGroup(value: unknown): StoredGroup | null {
  const source = record(value)
  const id = source.id
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null
  const windowId = source.windowId
  const tabIds = Array.isArray(source.tabIds)
    ? source.tabIds.filter(
        (tabId): tabId is number => typeof tabId === 'number' && Number.isInteger(tabId)
      )
    : []
  return {
    id,
    title: typeof source.title === 'string' ? source.title : '',
    color: normalizeColor(source.color),
    collapsed: source.collapsed === true,
    windowId: typeof windowId === 'number' && Number.isInteger(windowId) ? windowId : -1,
    tabIds: [...new Set(tabIds)]
  }
}

function readGroups(profileId: string): StoredGroup[] {
  const stored = getApiSetting<unknown>(profileId, keyFor(profileId), [])
  if (!Array.isArray(stored)) return []
  return stored.map(normalizeGroup).filter((group): group is StoredGroup => group !== null)
}

function writeGroups(profileId: string, groups: StoredGroup[]): void {
  setApiSetting(
    profileId,
    keyFor(profileId),
    groups.map((group) => ({ ...group, tabIds: [...group.tabIds] }))
  )
}

/**
 * tabMetadata allocates group ids from a process-local counter. Move that
 * counter past persisted ids when restoring a profile so a fresh tabs.group
 * call cannot reuse an id that is already on disk.
 */
function advanceIdCounter(maxId: number): void {
  if (maxId <= seededMaxId) return
  while (groupTabs([]) <= maxId) {
    // Each empty call consumes one id without changing any tab.
  }
  seededMaxId = maxId
}

function emit(profileId: string, event: string, args: unknown[]): void {
  broadcastExtensionApiEvent(profileId, { path: ['tabGroups'], event, args })
}

function groupWindowId(group: StoredGroup, live: Map<number, ExtensionTabEntry>): number {
  for (const tabId of group.tabIds) {
    const entry = live.get(tabId)
    if (entry) return entry.window.window.id
  }
  return group.windowId
}

function chromeGroup(group: StoredGroup, live: Map<number, ExtensionTabEntry>): ChromeTabGroup {
  return {
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    windowId: groupWindowId(group, live),
    tabIds: [...group.tabIds]
  }
}

/**
 * Keep the persisted map and tabMetadata in step. On the first read the stored
 * membership is replayed into live tabs; afterwards tabMetadata is the source
 * of truth, so grouping performed through chrome.tabs is visible here and
 * ungrouping is not overwritten.
 */
function reconcile(profileId: string): ReconciledGroups {
  const stored = readGroups(profileId)
  const first = !hydrated.has(profileId)
  advanceIdCounter(stored.reduce((max, group) => Math.max(max, group.id), 0))

  const live = new Map<number, ExtensionTabEntry>(
    extensionTabEntries(profileId).map((entry) => [entry.webContentsId, entry])
  )
  const byId = new Map(stored.map((group) => [group.id, group]))
  const kept: StoredGroup[] = []
  const created: ChromeTabGroup[] = []
  const removed: ChromeTabGroup[] = []
  let changed = false

  for (const group of stored) {
    const tabIds = group.tabIds.filter((tabId) => {
      const entry = live.get(tabId)
      if (!entry) return false
      if (first) {
        groupTabs([tabId], group.id)
        return true
      }
      return tabGroupId(tabId) === group.id
    })
    if (tabIds.length === 0) {
      removed.push(chromeGroup(group, live))
      changed = true
      continue
    }
    if (tabIds.length !== group.tabIds.length) changed = true
    group.tabIds = tabIds
    kept.push(group)
  }

  for (const entry of live.values()) {
    const groupId = tabGroupId(entry.webContentsId)
    if (groupId < 0) continue
    let group = byId.get(groupId)
    if (!group) {
      group = {
        id: groupId,
        title: '',
        color: 'grey',
        collapsed: false,
        windowId: entry.window.window.id,
        tabIds: []
      }
      byId.set(groupId, group)
      kept.push(group)
      created.push(chromeGroup(group, live))
      changed = true
    }
    if (!group.tabIds.includes(entry.webContentsId)) {
      group.tabIds.push(entry.webContentsId)
      changed = true
    }
    if (group.tabIds.length === 1 && group.windowId !== entry.window.window.id) {
      group.windowId = entry.window.window.id
      changed = true
    }
  }

  hydrated.add(profileId)
  if (changed) writeGroups(profileId, kept)
  if (!first) {
    for (const group of removed) emit(profileId, 'onRemoved', [group])
    for (const group of created) emit(profileId, 'onCreated', [group])
  }
  return { groups: kept.sort((a, b) => a.id - b.id), live }
}

function findGroup(groups: StoredGroup[], value: unknown): StoredGroup {
  const id = Number(value)
  const group = Number.isInteger(id) ? groups.find((candidate) => candidate.id === id) : undefined
  if (!group) throw new Error('Tab group not found')
  return group
}

function resolveWindowId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value === -2) return activeWindow()?.window.id ?? null
  if (value < 0) return null
  return value
}

export function registerTabGroups(): void {
  registerExtensionApiHandler('tabGroups', {
    invoke(context, method, args): unknown {
      const profileId = context.profileId

      if (method === 'get') {
        const { groups, live } = reconcile(profileId)
        return chromeGroup(findGroup(groups, args[0]), live)
      }

      if (method === 'getAll') {
        const { groups, live } = reconcile(profileId)
        return groups.map((group) => chromeGroup(group, live))
      }

      if (method === 'query') {
        const info = record(args[0])
        const requestedWindowId = resolveWindowId(info.windowId)
        const wantedTabs = Array.isArray(info.tabIds)
          ? info.tabIds.filter((id): id is number => typeof id === 'number')
          : undefined
        const { groups, live } = reconcile(profileId)
        return groups
          .filter((group) => {
            if (requestedWindowId !== null && groupWindowId(group, live) !== requestedWindowId) {
              return false
            }
            return !wantedTabs || group.tabIds.some((tabId) => wantedTabs.includes(tabId))
          })
          .map((group) => chromeGroup(group, live))
      }

      if (method === 'update') {
        const { groups, live } = reconcile(profileId)
        const group = findGroup(groups, args[0])
        const patch = record(args[1])
        let changed = false
        if (typeof patch.title === 'string' && patch.title !== group.title) {
          group.title = patch.title
          changed = true
        }
        const color = patch.color === 'gray' ? 'grey' : patch.color
        if (isColor(color) && color !== group.color) {
          group.color = color
          changed = true
        }
        if (typeof patch.collapsed === 'boolean' && patch.collapsed !== group.collapsed) {
          group.collapsed = patch.collapsed
          changed = true
        }
        if (changed) {
          writeGroups(profileId, groups)
          emit(profileId, 'onUpdated', [chromeGroup(group, live)])
        }
        return chromeGroup(group, live)
      }

      if (method === 'move') {
        const { groups, live } = reconcile(profileId)
        const group = findGroup(groups, args[0])
        const moveInfo: Record<string, unknown> =
          typeof args[1] === 'number' ? { index: args[1] } : record(args[1])
        const requested = moveInfo.index
        if (typeof requested !== 'number' || !Number.isInteger(requested)) {
          throw new Error('A target index is required to move a tab group.')
        }
        const entries = group.tabIds
          .map((tabId) => live.get(tabId))
          .filter((entry): entry is ExtensionTabEntry => entry !== undefined)
        const owner = entries[0]?.window
        if (!owner || entries.some((entry) => entry.window !== owner)) {
          throw new Error('Moving a tab group across windows is not supported.')
        }
        if (typeof moveInfo.windowId === 'number' && moveInfo.windowId >= 0) {
          const target = resolveWindowId(moveInfo.windowId)
          if (target !== null && target !== owner.window.id) {
            throw new Error('Moving a tab group across windows is not supported.')
          }
        }

        const before = owner.tabs.snapshot()
        const internalByTab = new Map(
          entriesForWindow(owner, before).map((entry) => [entry.webContentsId, entry.internalId])
        )
        const groupInternals = new Set(
          group.tabIds
            .map((tabId) => internalByTab.get(tabId))
            .filter((id): id is string => id !== undefined)
        )
        if (groupInternals.size === 0) throw new Error('Tab group has no live tabs to move.')
        const others = before.tabs.filter((tab) => !groupInternals.has(tab.id)).map((tab) => tab.id)
        const grouped = before.tabs.filter((tab) => groupInternals.has(tab.id)).map((tab) => tab.id)
        // Chrome uses -1 for "at the end" and accepts out-of-range indexes.
        const index = requested < 0 ? others.length : Math.min(requested, others.length)
        owner.tabs.reorder([...others.slice(0, index), ...grouped, ...others.slice(index)])

        group.windowId = owner.window.id
        writeGroups(profileId, groups)
        emit(profileId, 'onMoved', [chromeGroup(group, live)])
        return chromeGroup(group, live)
      }

      throw new Error(`chrome.tabGroups.${method} is not supported.`)
    }
  })
}
