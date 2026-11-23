import { contextBridge, ipcRenderer } from 'electron'
import type { ExtensionWebNavigationDetails } from '../shared/extensionNavigation'
import { IpcChannels } from '../shared/ipc-channels'

type Listener = (details: ExtensionWebNavigationDetails) => void

interface NavigationBridge {
  addListener(listener: Listener): void
  removeListener(listener: Listener): void
  hasListener(listener: Listener): boolean
}

/**
 * Install `chrome.webNavigation` in extension main worlds. Electron's extension
 * support omits this namespace, so extensions that register navigation listeners
 * at startup throw before their service worker can finish loading.
 *
 * This function is serialized into the main world by `executeInMainWorld`, so it
 * must not close over anything outside its own body.
 */
function install(): void {
  const chrome = (globalThis as any).chrome
  const bridge = (globalThis as any).__voyagerExtensionNav as NavigationBridge | undefined
  if (!chrome || chrome.webNavigation || !bridge) return

  const event = () => ({
    addListener: (listener: Listener): void => bridge.addListener(listener),
    removeListener: (listener: Listener): void => bridge.removeListener(listener),
    hasListener: (listener: Listener): boolean => bridge.hasListener(listener)
  })

  const frameLookup =
    (value: null | never[]) =>
    (details: unknown, callback?: (result: null | never[]) => void): Promise<null | never[]> => {
      void details
      const result = Promise.resolve(value)
      if (callback) void result.then(callback)
      return result
    }

  try {
    Object.defineProperty(chrome, 'webNavigation', {
      value: {
        onBeforeNavigate: event(),
        onCommitted: event(),
        onDOMContentLoaded: event(),
        onCompleted: event(),
        onCreatedNavigationTarget: event(),
        onErrorOccurred: event(),
        onHistoryStateUpdated: event(),
        onReferenceFragmentUpdated: event(),
        onTabReplaced: event(),
        getFrame: frameLookup(null),
        getAllFrames: frameLookup([])
      },
      enumerable: true,
      configurable: true
    })
  } catch (error) {
    console.warn('[voyager] Could not install chrome.webNavigation shim:', error)
  }
}

const inExtension =
  typeof globalThis.location === 'undefined' || globalThis.location.protocol === 'chrome-extension:'

if (inExtension) {
  const listeners = new Set<Listener>()
  ipcRenderer.on(IpcChannels.ExtensionWebNavigationEvent, (_event, details) => {
    for (const listener of [...listeners]) {
      try {
        listener(details)
      } catch {
        // A broken extension listener must not break Voyager or other extensions.
      }
    }
  })

  const bridge: NavigationBridge = {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    hasListener: (listener) => listeners.has(listener)
  }

  if (!process.contextIsolated) {
    // Service worker preload realms share the main world.
    ;(globalThis as any).__voyagerExtensionNav = bridge
    install()
  } else {
    try {
      contextBridge.exposeInMainWorld('__voyagerExtensionNav', bridge)
    } catch {
      // The bridge may already be exposed when a preload is re-run in a frame.
    }
    contextBridge.executeInMainWorld({ func: install })
  }
}
