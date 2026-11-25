import { screen, type Display } from 'electron'
import { listProfiles } from '../../profiles/profiles'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

const PATH = 'system.display'

interface Bounds {
  left: number
  top: number
  width: number
  height: number
}

interface DisplayMetrics {
  id: string
  width: number
  height: number
  availWidth: number
  availHeight: number
  dpiX: number
  dpiY: number
  devicePixelRatio: number
}

let attached = false

const boundsFrom = (rect: Display['bounds']): Bounds => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height
})

const dpiFor = (display: Display): number =>
  Math.round(96 * (display.scaleFactor > 0 ? display.scaleFactor : 1))

function displayInfo(display: Display, primaryId: number): Record<string, unknown> {
  const dpi = dpiFor(display)
  return {
    id: String(display.id),
    name: display.label || `Display ${display.id}`,
    isPrimary: display.id === primaryId,
    isEnabled: display.detected !== false,
    isInternal: display.internal === true,
    isUnified: display.id === -10,
    bounds: boundsFrom(display.bounds),
    workArea: boundsFrom(display.workArea),
    dpiX: dpi,
    dpiY: dpi,
    rotation: display.rotation,
    displayZoomFactor: display.scaleFactor > 0 ? display.scaleFactor : 1,
    mirroringSourceId: '',
    mirroringDestinationIds: [],
    overscan: { left: 0, top: 0, right: 0, bottom: 0 },
    modes: []
  }
}

function metricsFrom(primary: Display): DisplayMetrics {
  const dpi = dpiFor(primary)
  return {
    id: String(primary.id),
    width: primary.size.width,
    height: primary.size.height,
    availWidth: primary.workArea.width,
    availHeight: primary.workArea.height,
    dpiX: dpi,
    dpiY: dpi,
    devicePixelRatio: primary.scaleFactor > 0 ? primary.scaleFactor : 1
  }
}

function emitDisplayChanged(): void {
  for (const profile of listProfiles()) {
    broadcastExtensionApiEvent(
      profile.id,
      { path: PATH.split('.'), event: 'onDisplayChanged', args: [] },
      PATH
    )
  }
}

/** Forward Electron display configuration changes once. */
export function attachSystemDisplayEvents(): void {
  if (attached) return
  attached = true
  screen.on('display-added', () => emitDisplayChanged())
  screen.on('display-removed', () => emitDisplayChanged())
  screen.on('display-metrics-changed', () => emitDisplayChanged())
}

export function registerSystemDisplay(): void {
  attachSystemDisplayEvents()
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(_context, method, _args): unknown {
      if (method === 'getInfo') {
        const primaryId = screen.getPrimaryDisplay().id
        return screen.getAllDisplays().map((display) => displayInfo(display, primaryId))
      }
      if (method === 'getMetrics') {
        return metricsFrom(screen.getPrimaryDisplay())
      }
      if (method === 'setBrightness') {
        return true
      }
      if (method === 'clearBrightness') {
        return undefined
      }
      if (method === 'enableUnifiedDesktop') {
        return true
      }
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
