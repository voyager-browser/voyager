import type { ExtensionTab } from '../../../shared/extensionTabs'
import { createWindow } from '../../window/createWindow'
import type { WindowController } from '../../window/WindowController'
import { activeWindow, allWindows, onActiveWindowChange } from '../../window/windowRegistry'
import { asExtensionTab, entriesForWindow } from '../tabProjection'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'

type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen'

interface ChromeWindow {
  id: number
  focused: boolean
  incognito: boolean
  type: 'normal' | 'popup' | 'panel' | 'app'
  state: WindowState
  alwaysOnTop: boolean
  left: number
  top: number
  width: number
  height: number
  bounds: { left: number; top: number; width: number; height: number }
  tabs: ExtensionTab[]
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const keyFor = (profileId: string): string => `windows:${profileId}`

function readIdMap(profileId: string): Map<number, number> {
  const stored = getApiSetting<unknown>(profileId, keyFor(profileId), {})
  const map = new Map<number, number>()
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return map
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const nativeId = Number(key)
    if (Number.isInteger(nativeId) && typeof value === 'number' && Number.isInteger(value)) {
      map.set(nativeId, value)
    }
  }
  return map
}

function writeIdMap(profileId: string, map: Map<number, number>): void {
  const stored: Record<string, number> = {}
  for (const [nativeId, chromeId] of map) stored[String(nativeId)] = chromeId
  setApiSetting(profileId, keyFor(profileId), stored)
}

/**
 * Persist window ids per profile. Electron ids are reused as Chrome ids so the
 * `windowId` on tabs from tabProjection stays valid for chrome.windows calls.
 */
function chromeWindowId(profileId: string, controller: WindowController): number {
  const nativeId = controller.window.id
  const map = readIdMap(profileId)
  let id = map.get(nativeId)
  if (id === undefined) {
    id = nativeId
    map.set(nativeId, id)
    writeIdMap(profileId, map)
  }
  return id
}

function forgetWindow(profileId: string, nativeId: number): void {
  const map = readIdMap(profileId)
  if (map.delete(nativeId)) writeIdMap(profileId, map)
}

function controllerForId(profileId: string, id: number): WindowController | null {
  for (const controller of allWindows()) {
    if (controller.profile !== profileId || controller.window.isDestroyed()) continue
    if (chromeWindowId(profileId, controller) === id) return controller
  }
  return null
}

function resolveWindowId(profileId: string, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value === -2) return activeWindow()?.window.id ?? null
  if (value < 0) return null
  return controllerForId(profileId, value)?.window.id ?? null
}

function windowState(controller: WindowController): WindowState {
  if (controller.window.isFullScreen()) return 'fullscreen'
  if (controller.window.isMinimized()) return 'minimized'
  if (controller.window.isMaximized()) return 'maximized'
  return 'normal'
}

function asChromeWindow(profileId: string, controller: WindowController): ChromeWindow {
  const id = chromeWindowId(profileId, controller)
  const bounds = controller.window.getBounds()
  return {
    id,
    focused: activeWindow() === controller,
    incognito: controller.isIncognito,
    type: 'normal',
    state: windowState(controller),
    alwaysOnTop: controller.window.isAlwaysOnTop(),
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    bounds: { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height },
    tabs: entriesForWindow(controller, controller.tabs.snapshot()).map((entry) => ({
      ...asExtensionTab(entry),
      windowId: id
    }))
  }
}

function emit(profileId: string, event: string, args: unknown[]): void {
  broadcastExtensionApiEvent(profileId, { path: ['windows'], event, args })
}

const discovered = new WeakSet<WindowController>()
const hooked = new WeakSet<WindowController>()
let focusHookAttached = false
let lastFocused: WindowController | null = null

function discover(controller: WindowController): void {
  if (controller.window.isDestroyed()) return
  if (!hooked.has(controller)) {
    hooked.add(controller)
    controller.onDestroyed(() => {
      emit(controller.profile, 'onRemoved', [chromeWindowId(controller.profile, controller)])
      forgetWindow(controller.profile, controller.window.id)
    })
  }
  if (discovered.has(controller)) return
  discovered.add(controller)
  emit(controller.profile, 'onCreated', [asChromeWindow(controller.profile, controller)])
}

function discoverAll(): void {
  for (const controller of allWindows()) discover(controller)
}

function attachFocusHook(): void {
  if (focusHookAttached) return
  focusHookAttached = true
  onActiveWindowChange(() => {
    const next = activeWindow()
    if (!next || next.window.isDestroyed()) {
      if (lastFocused) emit(lastFocused.profile, 'onFocusChanged', [-1])
      lastFocused = null
      return
    }
    discoverAll()
    emit(next.profile, 'onFocusChanged', [chromeWindowId(next.profile, next)])
    lastFocused = next
  })
}

function applyState(controller: WindowController, state: string): void {
  const native = controller.window
  if (state === 'minimized') {
    if (native.isMinimized()) native.restore()
    native.minimize()
    return
  }
  if (state === 'maximized') {
    if (native.isMinimized()) native.restore()
    native.maximize()
    return
  }
  if (state === 'fullscreen') {
    if (!native.isFullScreen()) native.setFullScreen(true)
    return
  }
  if (native.isFullScreen()) native.setFullScreen(false)
  if (native.isMinimized()) native.restore()
}

function applyBounds(controller: WindowController, patch: Record<string, unknown>): void {
  const box = record(patch.bounds)
  const current = controller.window.getBounds()
  controller.window.setBounds({
    x: numberValue(box.left) ?? numberValue(box.x) ?? numberValue(patch.left) ?? current.x,
    y: numberValue(box.top) ?? numberValue(box.y) ?? numberValue(patch.top) ?? current.y,
    width: numberValue(box.width) ?? numberValue(patch.width) ?? current.width,
    height: numberValue(box.height) ?? numberValue(patch.height) ?? current.height
  })
}

function hasBounds(patch: Record<string, unknown>): boolean {
  const box = record(patch.bounds)
  return (
    patch.bounds !== undefined ||
    patch.left !== undefined ||
    patch.top !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    box.x !== undefined ||
    box.y !== undefined ||
    box.width !== undefined ||
    box.height !== undefined
  )
}

function profileWindows(profileId: string): WindowController[] {
  return allWindows().filter(
    (controller) => controller.profile === profileId && !controller.window.isDestroyed()
  )
}

function currentWindow(profileId: string): WindowController {
  const focused = activeWindow()
  if (focused && focused.profile === profileId && !focused.window.isDestroyed()) return focused
  const candidate = profileWindows(profileId)[0]
  if (!candidate) throw new Error('No window is available for this profile')
  return candidate
}

export function registerWindows(): void {
  attachFocusHook()
  registerExtensionApiHandler('windows', {
    invoke(context, method, args): unknown {
      const profileId = context.profileId
      discoverAll()

      if (method === 'get') {
        const id = resolveWindowId(profileId, args[0])
        const controller = id === null ? null : controllerForId(profileId, id)
        if (!controller) throw new Error('Window not found')
        return asChromeWindow(profileId, controller)
      }

      if (method === 'getAll') {
        const info = record(args[0])
        if (
          Array.isArray(info.windowTypes) &&
          !info.windowTypes.includes('normal') &&
          info.windowTypes.length > 0
        ) {
          return []
        }
        return profileWindows(profileId).map((controller) => asChromeWindow(profileId, controller))
      }

      if (method === 'getCurrent' || method === 'getLastFocused') {
        return asChromeWindow(profileId, currentWindow(profileId))
      }

      if (method === 'create') {
        const options = record(args[0])
        const rawUrl = options.url
        const urls =
          typeof rawUrl === 'string'
            ? [rawUrl]
            : Array.isArray(rawUrl)
              ? rawUrl.filter((value): value is string => typeof value === 'string' && value !== '')
              : []
        const controller = createWindow({
          incognito: options.incognito === true,
          profileId,
          ...(urls[0] ? { url: urls[0] } : {})
        })
        if (urls.length > 1) {
          const remaining = urls.slice(1)
          controller.chrome.webContents.once('did-finish-load', () => {
            // Defer until show() has restored/opened its initial tab.
            setTimeout(() => {
              if (controller.window.isDestroyed()) return
              for (const url of remaining) controller.openUrl(url)
            }, 0)
          })
        }
        if (typeof options.state === 'string') applyState(controller, options.state)
        if (hasBounds(options)) applyBounds(controller, options)
        if (options.focused === false) controller.window.blur()
        discover(controller)
        return asChromeWindow(profileId, controller)
      }

      if (method === 'update') {
        const id = resolveWindowId(profileId, args[0])
        const controller = id === null ? null : controllerForId(profileId, id)
        if (!controller) throw new Error('Window not found')
        const patch = record(args[1])
        const native = controller.window
        if (typeof patch.focused === 'boolean') {
          if (patch.focused) native.focus()
          else native.blur()
        }
        if (typeof patch.minimized === 'boolean') {
          if (patch.minimized) applyState(controller, 'minimized')
          else if (native.isMinimized()) native.restore()
        }
        if (typeof patch.maximized === 'boolean') {
          if (patch.maximized) applyState(controller, 'maximized')
          else if (native.isMaximized()) native.unmaximize()
        }
        if (typeof patch.fullscreen === 'boolean') {
          if (patch.fullscreen) applyState(controller, 'fullscreen')
          else if (native.isFullScreen()) native.setFullScreen(false)
        }
        if (typeof patch.state === 'string') applyState(controller, patch.state)
        if (typeof patch.alwaysOnTop === 'boolean') native.setAlwaysOnTop(patch.alwaysOnTop)
        if (hasBounds(patch)) applyBounds(controller, patch)
        return asChromeWindow(profileId, controller)
      }

      if (method === 'remove') {
        const id = resolveWindowId(profileId, args[0])
        const controller = id === null ? null : controllerForId(profileId, id)
        if (!controller) throw new Error('Window not found')
        discover(controller)
        controller.window.close()
        return undefined
      }

      throw new Error(`chrome.windows.${method} is not supported.`)
    }
  })
}
