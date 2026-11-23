import { contextBridge, ipcRenderer } from 'electron'
import type { ExtensionWebNavigationDetails } from '../shared/extensionNavigation'
import { IpcChannels } from '../shared/ipc-channels'

type Listener = (details: ExtensionWebNavigationDetails) => void

interface ExtensionTabsCreateDetails {
  url?: string
  active?: boolean
  index?: number
}

interface ExtensionPermissionsDetails {
  permissions?: string[]
  origins?: string[]
}

const TABS_CREATE_BRIDGE = '__voyagerExtensionTabsCreate'
const PERMISSIONS_BRIDGE = '__voyagerExtensionPermissions'
const NATIVE_CONNECT_BRIDGE = '__voyagerExtensionNativeConnect'
const NATIVE_POST_BRIDGE = '__voyagerExtensionNativePost'
const NATIVE_DISCONNECT_BRIDGE = '__voyagerExtensionNativeDisconnect'
const NATIVE_SEND_BRIDGE = '__voyagerExtensionNativeSend'

/**
 * Install the Chrome extension APIs Electron omits: `webNavigation`,
 * `tabs.create`, `permissions`, and native messaging. This function is
 * serialized into the extension's main world, so it must be self-contained.
 *
 * This function is serialized into the main world by `executeInMainWorld`, so
 * it must not close over anything outside its own body.
 */
const install = function install(): void {
  const self = install as any
  self.attempts = (self.attempts ?? 0) + 1
  const chrome = (globalThis as any).chrome
  if (!chrome) {
    // Extension bindings can be injected after the preload runs.
    if (self.attempts < 500) setTimeout(install, 10)
    return
  }

  const define = (target: any, key: string, value: any): boolean => {
    try {
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
      return true
    } catch {
      try {
        target[key] = value
        return true
      } catch {
        return false
      }
    }
  }

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

  const createTab = (globalThis as any).__voyagerExtensionTabsCreate
  if (typeof createTab === 'function') {
    try {
      const tabs = chrome.tabs ?? {}
      const create = (
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
      }
      if (define(tabs, 'create', create) && !chrome.tabs) {
        define(chrome, 'tabs', tabs)
      }
    } catch (error) {
      console.warn('[voyager] Could not install chrome.tabs.create shim:', error)
    }
  }

  const permissionBridge = (globalThis as any).__voyagerExtensionPermissions
  if (typeof permissionBridge === 'function') {
    try {
      const permissions = chrome.permissions ?? {}
      const call =
        (mode: 'request' | 'contains' | 'getAll' | 'remove') =>
        (details?: ExtensionPermissionsDetails, callback?: (result: any) => void): Promise<any> => {
          const input = details && typeof details === 'object' ? details : {}
          const result = Promise.resolve(permissionBridge({ ...input, mode }))
          if (typeof callback === 'function') void result.then(callback)
          return result
        }
      define(permissions, 'request', call('request'))
      define(permissions, 'contains', call('contains'))
      define(permissions, 'getAll', call('getAll'))
      define(permissions, 'remove', call('remove'))
      if (!chrome.permissions) define(chrome, 'permissions', permissions)
    } catch (error) {
      console.warn('[voyager] Could not install chrome.permissions shim:', error)
    }
  }

  const nativeConnect = (globalThis as any).__voyagerExtensionNativeConnect
  const nativePost = (globalThis as any).__voyagerExtensionNativePost
  const nativeDisconnect = (globalThis as any).__voyagerExtensionNativeDisconnect
  const nativeSend = (globalThis as any).__voyagerExtensionNativeSend
  if (
    typeof nativeConnect === 'function' &&
    typeof nativePost === 'function' &&
    typeof nativeDisconnect === 'function' &&
    typeof nativeSend === 'function'
  ) {
    try {
      const portRecords = new Map<
        string,
        { message: Set<(message: any) => void>; disconnect: Set<() => void> }
      >()
      const emit = (listeners: Set<any>, argument?: any): void => {
        for (const listener of [...listeners]) {
          try {
            listener(argument)
          } catch {
            // One bad extension listener must not break the native port.
          }
        }
      }

      Object.defineProperty(globalThis, '__voyagerExtensionNativeMessage', {
        value: (payload: { portId?: string; message?: any } | undefined): void => {
          const record = payload?.portId ? portRecords.get(payload.portId) : undefined
          if (record) emit(record.message, payload?.message)
        },
        configurable: true
      })
      Object.defineProperty(globalThis, '__voyagerExtensionNativeDisconnectDispatch', {
        value: (payload: { portId?: string } | undefined): void => {
          const portId = payload?.portId
          if (!portId) return
          const record = portRecords.get(portId)
          if (!record) return
          portRecords.delete(portId)
          emit(record.disconnect)
        },
        configurable: true
      })

      const makeEvent = (listeners: Set<any>) => ({
        addListener(listener: any): void {
          listeners.add(listener)
        },
        removeListener(listener: any): void {
          listeners.delete(listener)
        },
        hasListener(listener: any): boolean {
          return listeners.has(listener)
        }
      })
      const makePortId = (): string =>
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `port-${Date.now()}-${Math.random().toString(16).slice(2)}`

      const runtime = chrome.runtime ?? {}
      define(runtime, 'connectNative', (hostName: string): any => {
        const portId = makePortId()
        const record: {
          message: Set<(message: any) => void>
          disconnect: Set<() => void>
        } = { message: new Set(), disconnect: new Set() }
        portRecords.set(portId, record)
        void Promise.resolve(nativeConnect(hostName, portId)).then((result: unknown) => {
          if (typeof result !== 'string') {
            portRecords.delete(portId)
            emit(record.disconnect)
          }
        })
        return {
          name: hostName,
          onMessage: makeEvent(record.message),
          onDisconnect: makeEvent(record.disconnect),
          postMessage(message: any): void {
            void nativePost(portId, message)
          },
          disconnect(): void {
            portRecords.delete(portId)
            void nativeDisconnect(portId)
          }
        }
      })
      define(
        runtime,
        'sendNativeMessage',
        (hostName: string, message: any, callback?: (response: any) => void): Promise<any> => {
          const result = Promise.resolve(nativeSend(hostName, message))
          if (typeof callback === 'function') void result.then(callback)
          return result
        }
      )
      if (!chrome.runtime) define(chrome, 'runtime', runtime)
    } catch (error) {
      console.warn('[voyager] Could not install native messaging shim:', error)
    }
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

  ipcRenderer.on(
    IpcChannels.ExtensionNativeMessageEvent,
    (_event, payload: { portId: string; message: unknown }) => {
      const dispatch = (value: typeof payload): void => {
        const handler = (globalThis as any).__voyagerExtensionNativeMessage
        if (handler) handler(value)
      }
      if (process.contextIsolated) {
        void contextBridge.executeInMainWorld({
          func: (eventPayload: { portId: string; message: unknown }) => {
            const handler = (globalThis as any).__voyagerExtensionNativeMessage
            if (handler) handler(eventPayload)
          },
          args: [payload]
        })
      } else {
        dispatch(payload)
      }
    }
  )
  ipcRenderer.on(
    IpcChannels.ExtensionNativeDisconnectEvent,
    (_event, payload: { portId: string }) => {
      const dispatch = (value: typeof payload): void => {
        const handler = (globalThis as any).__voyagerExtensionNativeDisconnectDispatch
        if (handler) handler(value)
      }
      if (process.contextIsolated) {
        void contextBridge.executeInMainWorld({
          func: (eventPayload: { portId: string }) => {
            const handler = (globalThis as any).__voyagerExtensionNativeDisconnectDispatch
            if (handler) handler(eventPayload)
          },
          args: [payload]
        })
      } else {
        dispatch(payload)
      }
    }
  )

  const createTabBridge = (details: ExtensionTabsCreateDetails): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionTabsCreate, details)
  const permissionsBridge = (
    details: ExtensionPermissionsDetails & { mode?: string; checkOnly?: boolean }
  ) => ipcRenderer.invoke(IpcChannels.ExtensionPermissionRequest, details)
  const nativeConnectBridge = (hostName: string, portId: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionNativeConnect, hostName, portId)
  const nativePostBridge = (portId: string, message: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionNativePostMessage, portId, message)
  const nativeDisconnectBridge = (portId: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionNativeDisconnect, portId)
  const nativeSendBridge = (hostName: string, message: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ExtensionNativeSendMessage, hostName, message)

  const bridges: Record<string, (...args: any[]) => Promise<unknown>> = {
    [TABS_CREATE_BRIDGE]: createTabBridge,
    [PERMISSIONS_BRIDGE]: permissionsBridge,
    [NATIVE_CONNECT_BRIDGE]: nativeConnectBridge,
    [NATIVE_POST_BRIDGE]: nativePostBridge,
    [NATIVE_DISCONNECT_BRIDGE]: nativeDisconnectBridge,
    [NATIVE_SEND_BRIDGE]: nativeSendBridge
  }
  if (process.contextIsolated) {
    for (const [key, value] of Object.entries(bridges)) {
      contextBridge.exposeInMainWorld(key, value)
    }
    void contextBridge.executeInMainWorld({ func: install })
  } else {
    // Service worker preload realms share the main world.
    for (const [key, value] of Object.entries(bridges)) {
      Object.defineProperty(globalThis, key, { value, configurable: true })
    }
    install()
  }
}
