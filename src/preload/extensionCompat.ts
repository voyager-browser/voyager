import { contextBridge, ipcRenderer } from 'electron'
import type { ExtensionWebNavigationDetails } from '../shared/extensionNavigation'
import { IpcChannels } from '../shared/ipc-channels'

type Listener = (details: ExtensionWebNavigationDetails) => void

interface ExtensionTabsCreateDetails {
  url?: string
  active?: boolean
  index?: number
}

const TABS_CREATE_BRIDGE = '__voyagerExtensionTabsCreate'

/**
 * Install `chrome.webNavigation` and the missing `chrome.tabs.create` method in
 * extension main worlds. Electron's extension support omits both, so extensions
 * that register navigation listeners or open tabs throw at startup.
 *
 * This function is serialized into the main world by `executeInMainWorld`, so
 * it must not close over anything outside its own body.
 */
function install(): void {
  const chrome = (globalThis as any).chrome
  if (!chrome) return

  if (!chrome.webNavigation) {
    const listeners = new Map<string, Set<Listener>>()

    const makeEvent = (name: string) => ({
      addListener(listener: Listener): void {
        let set = listeners.get(name)
        if (!set) {
          set = new Set()
          listeners.set(name, set)
        }
        set.add(listener)
      },
      removeListener(listener: Listener): void {
        listeners.get(name)?.delete(listener)
      },
      hasListener(listener: Listener): boolean {
        return listeners.get(name)?.has(listener) ?? false
      }
    })

    const frameLookup =
      (value: null | never[]) =>
      (_details: unknown, callback?: (result: null | never[]) => void): Promise<null | never[]> => {
        const result = Promise.resolve(value)
        if (callback) void result.then(callback)
        return result
      }

    try {
      Object.defineProperty(globalThis, '__voyagerWebNavDispatch', {
        value: (details: ExtensionWebNavigationDetails): void => {
          const set = listeners.get(details.event)
          if (!set) return
          for (const listener of [...set]) {
            try {
              listener(details)
            } catch {
              // A broken extension listener must not break Voyager or other extensions.
            }
          }
        },
        configurable: true
      })

      Object.defineProperty(chrome, 'webNavigation', {
        value: {
          onBeforeNavigate: makeEvent('onBeforeNavigate'),
          onCommitted: makeEvent('onCommitted'),
          onDOMContentLoaded: makeEvent('onDOMContentLoaded'),
          onCompleted: makeEvent('onCompleted'),
          onCreatedNavigationTarget: makeEvent('onCreatedNavigationTarget'),
          onErrorOccurred: makeEvent('onErrorOccurred'),
          onHistoryStateUpdated: makeEvent('onHistoryStateUpdated'),
          onReferenceFragmentUpdated: makeEvent('onReferenceFragmentUpdated'),
          onTabReplaced: makeEvent('onTabReplaced'),
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

  const createTab = (globalThis as any)[TABS_CREATE_BRIDGE]
  if (typeof createTab !== 'function') return
  if (chrome.tabs && typeof chrome.tabs.create === 'function') return

  try {
    const tabs = chrome.tabs ?? {}
    Object.defineProperty(tabs, 'create', {
      value: (
        details?: ExtensionTabsCreateDetails,
        callback?: (tab: { id: number; url?: string }) => void
      ): Promise<{ id: number; url?: string }> => {
        const input = details && typeof details === 'object' ? details : {}
        const result = Promise.resolve(createTab(input)).then((id: unknown) => ({
          id: typeof id === 'number' ? id : 0,
          url: typeof input.url === 'string' ? input.url : undefined
        }))
        if (typeof callback === 'function') void result.then(callback)
        return result
      },
      enumerable: true,
      configurable: true
    })
    if (!chrome.tabs) {
      Object.defineProperty(chrome, 'tabs', { value: tabs, enumerable: true, configurable: true })
    }
  } catch (error) {
    console.warn('[voyager] Could not install chrome.tabs.create shim:', error)
  }
}

const inExtension =
  typeof globalThis.location === 'undefined' || globalThis.location.protocol === 'chrome-extension:'

if (inExtension) {
  ipcRenderer.on(IpcChannels.ExtensionWebNavigationEvent, (_event, details) => {
    if (process.contextIsolated) {
      void contextBridge.executeInMainWorld({
        func: (eventDetails: ExtensionWebNavigationDetails) => {
          const dispatch = (globalThis as any).__voyagerWebNavDispatch
          if (dispatch) dispatch(eventDetails)
        },
        args: [details]
      })
    } else {
      const dispatch = (globalThis as any).__voyagerWebNavDispatch
      if (dispatch) dispatch(details)
    }
  })

  const createTabBridge = (details: ExtensionTabsCreateDetails): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionTabsCreate, details)
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld(TABS_CREATE_BRIDGE, createTabBridge)
    void contextBridge.executeInMainWorld({ func: install })
  } else {
    // Service worker preload realms share the main world.
    Object.defineProperty(globalThis, TABS_CREATE_BRIDGE, {
      value: createTabBridge,
      configurable: true
    })
    install()
  }
}
