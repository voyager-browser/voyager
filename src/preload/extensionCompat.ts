import { contextBridge, ipcRenderer } from 'electron'
import {
  EXTENSION_API_SCHEMA,
  type ExtensionApiCallRequest,
  type ExtensionApiEventPayload,
  type ExtensionApiMethodDefinition,
  type ExtensionApiNode
} from '../shared/extensionApi'
import type { ExtensionTabsEventDetails } from '../shared/extensionTabEvents'
import type { ExtensionWebNavigationDetails } from '../shared/extensionNavigation'
import { IpcChannels } from '../shared/ipc-channels'

type Listener = (details: ExtensionWebNavigationDetails) => void

interface ExtensionTabsCreateDetails {
  url?: string
  active?: boolean
  index?: number
  pinned?: boolean
  selected?: boolean
  openerTabId?: number
  splitWithTabId?: number
  windowId?: number
}

interface ExtensionPermissionsDetails {
  permissions?: string[]
  origins?: string[]
}

const TABS_CREATE_BRIDGE = '__voyagerExtensionTabsCreate'
const TABS_CALL_BRIDGE = '__voyagerExtensionTabsCall'
const OPEN_OPTIONS_BRIDGE = '__voyagerExtensionOpenOptionsPage'
const ACTION_OPEN_POPUP_BRIDGE = '__voyagerExtensionOpenPopup'
const PERMISSIONS_BRIDGE = '__voyagerExtensionPermissions'
const NATIVE_CONNECT_BRIDGE = '__voyagerExtensionNativeConnect'
const NATIVE_POST_BRIDGE = '__voyagerExtensionNativePost'
const NATIVE_DISCONNECT_BRIDGE = '__voyagerExtensionNativeDisconnect'
const NATIVE_SEND_BRIDGE = '__voyagerExtensionNativeSend'
const PRIVACY_GET_BRIDGE = '__voyagerExtensionPrivacyGet'
const PRIVACY_SET_BRIDGE = '__voyagerExtensionPrivacySet'
const API_CALL_BRIDGE = '__voyagerExtensionApiCall'

/**
 * Extension service workers can start before a main-process IPC handler is
 * ready during profile setup. Return a safe fallback instead of rejecting the
 * extension's promise, which would surface as a runtime error in its console.
 */
const safeInvoke = (channel: string, fallback: unknown, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    console.warn(`[voyager] Extension bridge ${channel} is unavailable:`, error)
    return fallback
  })

/**
 * Install the Chrome extension APIs Electron omits: `webNavigation`,
 * `tabs.create`, action popups, `permissions`, and native messaging.
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
        callback?: (tab: any) => void
      ): Promise<any> => {
        const input = details && typeof details === 'object' ? details : {}
        const lookup = (globalThis as any).__voyagerExtensionTabsCall
        const result = Promise.resolve(createTab(input)).then((id: unknown) => {
          const tabId = typeof id === 'number' ? id : 0
          const fallback = {
            id: tabId,
            url: typeof input.url === 'string' ? input.url : undefined
          }
          if (typeof lookup !== 'function') return fallback
          return Promise.resolve(lookup({ operation: 'get', tabId })).then(
            (tab: unknown) => tab ?? fallback
          )
        })
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

  const tabsCall = (globalThis as any).__voyagerExtensionTabsCall
  if (typeof tabsCall === 'function') {
    try {
      const tabs = chrome.tabs ?? {}
      const call = (
        payload: unknown,
        fallback: unknown,
        callback?: (result: any) => void
      ): Promise<any> => {
        const result = Promise.resolve(tabsCall(payload)).then((value) =>
          value === null || value === undefined ? fallback : value
        )
        if (typeof callback === 'function') void result.then(callback, () => callback(fallback))
        return result
      }
      const selectedTabId = (value: unknown): number | undefined =>
        typeof value === 'number' ? value : undefined
      const optionalCallback = (...values: unknown[]): ((result: any) => void) | undefined =>
        values.find((value): value is (result: any) => void => typeof value === 'function')
      const idList = (value: unknown): number[] =>
        Array.isArray(value)
          ? value.filter((id): id is number => typeof id === 'number')
          : typeof value === 'number'
            ? [value]
            : []

      const query = (queryInfoOrCallback?: unknown, maybeCallback?: unknown): Promise<any> => {
        const queryInfo =
          typeof queryInfoOrCallback === 'function' ? {} : (queryInfoOrCallback ?? {})
        const callback = optionalCallback(queryInfoOrCallback, maybeCallback)
        return call({ operation: 'query', queryInfo }, [], callback)
      }
      const get = (tabId: number, callback?: (result: any) => void): Promise<any> =>
        call({ operation: 'get', tabId }, null, callback)
      const getCurrent = (callback?: (result: any) => void): Promise<any> =>
        call({ operation: 'getCurrent' }, null, callback)
      const getSelected = (windowIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'getSelected', windowId: selectedTabId(windowIdOrCallback) },
          null,
          optionalCallback(windowIdOrCallback, maybeCallback)
        )
      const getAllInWindow = (
        windowIdOrCallback?: unknown,
        maybeCallback?: unknown
      ): Promise<any> =>
        call(
          { operation: 'getAllInWindow', windowId: selectedTabId(windowIdOrCallback) },
          [],
          optionalCallback(windowIdOrCallback, maybeCallback)
        )
      const remove = (tabIdOrIdsOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'remove', tabIds: idList(tabIdOrIdsOrCallback) },
          false,
          optionalCallback(tabIdOrIdsOrCallback, maybeCallback)
        )
      const update = (
        tabId: number,
        properties?: Record<string, unknown>,
        callback?: (result: any) => void
      ): Promise<any> =>
        call({ operation: 'update', tabId, updateProperties: properties ?? {} }, null, callback)
      const move = (
        tabIdOrIds: unknown,
        properties?: Record<string, unknown>,
        callback?: (result: any) => void
      ): Promise<any> =>
        call(
          {
            operation: 'move',
            tabIds: idList(tabIdOrIds),
            moveProperties: properties ?? {}
          },
          null,
          callback
        )
      const duplicate = (tabId: number, callback?: (result: any) => void): Promise<any> =>
        call({ operation: 'duplicate', tabId }, null, callback)
      const reload = (
        tabIdOrCallback?: unknown,
        propertiesOrCallback?: unknown,
        maybeCallback?: unknown
      ): Promise<any> => {
        const callback = optionalCallback(tabIdOrCallback, propertiesOrCallback, maybeCallback)
        const properties =
          propertiesOrCallback && typeof propertiesOrCallback === 'object'
            ? (propertiesOrCallback as Record<string, unknown>)
            : {}
        return call(
          {
            operation: 'reload',
            tabId: selectedTabId(tabIdOrCallback),
            bypassCache: properties.bypassCache === true
          },
          false,
          callback
        )
      }
      const navigation =
        (operation: 'goBack' | 'goForward') =>
        (tabIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
          call(
            { operation, tabId: selectedTabId(tabIdOrCallback) },
            false,
            optionalCallback(tabIdOrCallback, maybeCallback)
          )
      const getZoom = (tabIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'getZoom', tabId: selectedTabId(tabIdOrCallback) },
          null,
          optionalCallback(tabIdOrCallback, maybeCallback)
        )
      const setZoom = (
        tabIdOrZoom?: unknown,
        zoomOrCallback?: unknown,
        maybeCallback?: unknown
      ): Promise<any> => {
        const hasTabId = typeof tabIdOrZoom === 'number' && typeof zoomOrCallback === 'number'
        const zoom = typeof zoomOrCallback === 'number' ? zoomOrCallback : tabIdOrZoom
        return call(
          {
            operation: 'setZoom',
            tabId: hasTabId ? (tabIdOrZoom as number) : undefined,
            zoom: typeof zoom === 'number' ? zoom : undefined
          },
          false,
          optionalCallback(tabIdOrZoom, zoomOrCallback, maybeCallback)
        )
      }
      const getZoomSettings = (tabIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'getZoomSettings', tabId: selectedTabId(tabIdOrCallback) },
          { defaultZoomFactor: 1, mode: 'automatic', scope: 'per-origin' },
          optionalCallback(tabIdOrCallback, maybeCallback)
        )
      const setZoomSettings = (
        tabIdOrSettings?: unknown,
        settingsOrCallback?: unknown,
        maybeCallback?: unknown
      ): Promise<any> => {
        const hasTabId =
          typeof tabIdOrSettings === 'number' &&
          typeof settingsOrCallback === 'object' &&
          settingsOrCallback !== null
        const zoomSettings = hasTabId ? settingsOrCallback : tabIdOrSettings
        return call(
          {
            operation: 'setZoomSettings',
            tabId: hasTabId ? (tabIdOrSettings as number) : undefined,
            zoomSettings:
              typeof zoomSettings === 'object' && zoomSettings !== null ? zoomSettings : {}
          },
          false,
          optionalCallback(tabIdOrSettings, settingsOrCallback, maybeCallback)
        )
      }
      const discard = (tabIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'discard', tabId: selectedTabId(tabIdOrCallback) },
          null,
          optionalCallback(tabIdOrCallback, maybeCallback)
        )
      const detectLanguage = (tabIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'detectLanguage', tabId: selectedTabId(tabIdOrCallback) },
          'und',
          optionalCallback(tabIdOrCallback, maybeCallback)
        )
      const captureVisibleTab = (
        windowIdOrOptionsOrCallback?: unknown,
        optionsOrCallback?: unknown,
        maybeCallback?: unknown
      ): Promise<any> => {
        const callback = optionalCallback(
          windowIdOrOptionsOrCallback,
          optionsOrCallback,
          maybeCallback
        )
        const windowId = selectedTabId(windowIdOrOptionsOrCallback)
        const firstOptions =
          windowIdOrOptionsOrCallback && typeof windowIdOrOptionsOrCallback === 'object'
            ? windowIdOrOptionsOrCallback
            : undefined
        const secondOptions =
          optionsOrCallback && typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined
        return call(
          {
            operation: 'captureVisibleTab',
            windowId,
            imageDetails: (secondOptions ?? firstOptions) as Record<string, unknown> | undefined
          },
          '',
          callback
        )
      }
      const group = (optionsOrCallback?: unknown, maybeCallback?: unknown): Promise<any> => {
        const options =
          optionsOrCallback && typeof optionsOrCallback === 'object'
            ? (optionsOrCallback as Record<string, any>)
            : {}
        return call(
          {
            operation: 'group',
            tabIds: idList(options.tabIds),
            groupId: typeof options.groupId === 'number' ? options.groupId : undefined,
            windowId:
              typeof options.createProperties?.windowId === 'number'
                ? options.createProperties.windowId
                : undefined
          },
          -1,
          optionalCallback(optionsOrCallback, maybeCallback)
        )
      }
      const ungroup = (tabIdsOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'ungroup', tabIds: idList(tabIdsOrCallback) },
          undefined,
          optionalCallback(tabIdsOrCallback, maybeCallback)
        )
      const createSplit = (tabIdsOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'createSplit', tabIds: idList(tabIdsOrCallback) },
          -1,
          optionalCallback(tabIdsOrCallback, maybeCallback)
        )
      const unsplit = (splitIdOrCallback?: unknown, maybeCallback?: unknown): Promise<any> =>
        call(
          { operation: 'unsplit', splitViewId: selectedTabId(splitIdOrCallback) },
          undefined,
          optionalCallback(splitIdOrCallback, maybeCallback)
        )
      const select = (tabId: number, callback?: (result: any) => void): Promise<any> =>
        call({ operation: 'select', tabId }, null, callback)
      const highlight = (
        _windowId: number,
        info?: { tabs?: number | number[] },
        callback?: (result: any) => void
      ): Promise<any> => {
        const ids = Array.isArray(info?.tabs)
          ? info.tabs
          : typeof info?.tabs === 'number'
            ? [info.tabs]
            : []
        return call({ operation: 'highlight', tabIds: ids }, null, callback)
      }

      const methods: Record<string, unknown> = {
        query,
        get,
        getCurrent,
        getSelected,
        getAllInWindow,
        remove,
        update,
        move,
        duplicate,
        reload,
        goBack: navigation('goBack'),
        goForward: navigation('goForward'),
        getZoom,
        setZoom,
        getZoomSettings,
        setZoomSettings,
        discard,
        detectLanguage,
        captureVisibleTab,
        group,
        ungroup,
        createSplit,
        unsplit,
        select,
        highlight
      }
      for (const [key, value] of Object.entries(methods)) define(tabs, key, value)

      const nativeTabs = chrome.tabs ?? {}
      const scripting = chrome.scripting
      const setLastError = (message: string): void => {
        const runtime = chrome.runtime ?? {}
        define(runtime, 'lastError', { message })
        if (!chrome.runtime) define(chrome, 'runtime', runtime)
      }
      const scriptingTarget = (tabId: number): { tabId: number } => ({ tabId })
      const normalizeScriptingInjection = (
        details: Record<string, unknown>,
        kind: 'script' | 'css'
      ): Record<string, unknown> => {
        const normalized = { ...details }
        if (typeof normalized.file === 'string') {
          normalized.files = [normalized.file]
          delete normalized.file
        }
        if (typeof normalized.code === 'string') {
          if (kind === 'script') {
            try {
              normalized.func = new Function(String(normalized.code))
            } catch {
              normalized.func = undefined
            }
          } else {
            normalized.css = normalized.code
          }
          delete normalized.code
        }
        return normalized
      }
      if (typeof nativeTabs.sendMessage !== 'function') {
        define(
          tabs,
          'sendMessage',
          (
            _tabId: number,
            _message: unknown,
            optionsOrCallback?: unknown,
            maybeCallback?: unknown
          ): Promise<undefined> => {
            const callback = optionalCallback(optionsOrCallback, maybeCallback)
            setLastError('chrome.tabs.sendMessage is not available in this build.')
            const result = Promise.resolve(undefined)
            if (callback) void result.then(callback)
            return result
          }
        )
      }
      if (typeof nativeTabs.connect !== 'function') {
        define(tabs, 'connect', (): never => {
          throw new Error('chrome.tabs.connect is not supported by Electron.')
        })
      }
      if (typeof nativeTabs.executeScript !== 'function') {
        define(
          tabs,
          'executeScript',
          (
            tabIdOrDetails: unknown,
            detailsOrCallback?: unknown,
            maybeCallback?: unknown
          ): Promise<any> => {
            const callback = optionalCallback(detailsOrCallback, maybeCallback)
            const tabId = typeof tabIdOrDetails === 'number' ? tabIdOrDetails : undefined
            const details =
              typeof tabIdOrDetails === 'object' && tabIdOrDetails !== null
                ? (tabIdOrDetails as Record<string, unknown>)
                : typeof detailsOrCallback === 'object' && detailsOrCallback !== null
                  ? (detailsOrCallback as Record<string, unknown>)
                  : {}
            if (tabId === undefined || typeof scripting?.executeScript !== 'function') {
              setLastError('chrome.tabs.executeScript requires chrome.scripting in this build.')
              const result = Promise.resolve(undefined)
              if (callback) void result.then(callback)
              return result
            }
            const result = Promise.resolve(
              scripting.executeScript({
                target: scriptingTarget(tabId),
                ...normalizeScriptingInjection(details, 'script')
              } as any)
            ).then((injections: any) => injections?.[0]?.result)
            if (callback) void result.then(callback)
            return result
          }
        )
      }
      if (typeof nativeTabs.insertCSS !== 'function') {
        define(
          tabs,
          'insertCSS',
          (
            tabIdOrDetails: unknown,
            detailsOrCallback?: unknown,
            maybeCallback?: unknown
          ): Promise<void> => {
            const callback = optionalCallback(detailsOrCallback, maybeCallback)
            const tabId = typeof tabIdOrDetails === 'number' ? tabIdOrDetails : undefined
            const details =
              typeof tabIdOrDetails === 'object' && tabIdOrDetails !== null
                ? (tabIdOrDetails as Record<string, unknown>)
                : typeof detailsOrCallback === 'object' && detailsOrCallback !== null
                  ? (detailsOrCallback as Record<string, unknown>)
                  : {}
            if (tabId === undefined || typeof scripting?.insertCSS !== 'function') {
              setLastError('chrome.tabs.insertCSS requires chrome.scripting in this build.')
              const result = Promise.resolve()
              if (callback) void result.then(callback)
              return result
            }
            const result = Promise.resolve(
              scripting.insertCSS({
                target: scriptingTarget(tabId),
                ...normalizeScriptingInjection(details, 'css')
              } as any)
            ).then(() => undefined)
            if (callback) void result.then(callback)
            return result
          }
        )
      }
      if (typeof nativeTabs.removeCSS !== 'function') {
        define(
          tabs,
          'removeCSS',
          (
            tabIdOrDetails: unknown,
            detailsOrCallback?: unknown,
            maybeCallback?: unknown
          ): Promise<void> => {
            const callback = optionalCallback(detailsOrCallback, maybeCallback)
            const tabId = typeof tabIdOrDetails === 'number' ? tabIdOrDetails : undefined
            const details =
              typeof tabIdOrDetails === 'object' && tabIdOrDetails !== null
                ? (tabIdOrDetails as Record<string, unknown>)
                : typeof detailsOrCallback === 'object' && detailsOrCallback !== null
                  ? (detailsOrCallback as Record<string, unknown>)
                  : {}
            if (tabId === undefined || typeof scripting?.removeCSS !== 'function') {
              setLastError('chrome.tabs.removeCSS requires chrome.scripting in this build.')
              const result = Promise.resolve()
              if (callback) void result.then(callback)
              return result
            }
            const result = Promise.resolve(
              scripting.removeCSS({
                target: scriptingTarget(tabId),
                ...normalizeScriptingInjection(details, 'css')
              } as any)
            ).then(() => undefined)
            if (callback) void result.then(callback)
            return result
          }
        )
      }
      if (!chrome.tabs) define(chrome, 'tabs', tabs)
    } catch (error) {
      console.warn('[voyager] Could not install chrome.tabs shim:', error)
    }
  }

  try {
    const tabs = chrome.tabs ?? {}
    const tabsListeners = new Map<string, Set<(...args: any[]) => void>>()
    const canonicalTabsEvent = (name: string): string =>
      name === 'onZoomChanged' ? 'onZoomChange' : name
    const makeTabsEvent = (name: string) => {
      const key = canonicalTabsEvent(name)
      return {
        addListener(listener: (...args: any[]) => void): void {
          let set = tabsListeners.get(key)
          if (!set) {
            set = new Set()
            tabsListeners.set(key, set)
          }
          set.add(listener)
        },
        removeListener(listener: (...args: any[]) => void): void {
          tabsListeners.get(key)?.delete(listener)
        },
        hasListener(listener: (...args: any[]) => void): boolean {
          return tabsListeners.get(key)?.has(listener) ?? false
        }
      }
    }
    const eventNames = [
      'onActivated',
      'onAttached',
      'onCreated',
      'onDetached',
      'onHighlighted',
      'onMoved',
      'onRemoved',
      'onReplaced',
      'onUpdated',
      'onZoomChange',
      'onZoomChanged'
    ]
    for (const name of eventNames) define(tabs, name, makeTabsEvent(name))
    define(tabs, 'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND', 2)
    define(tabs, 'SPLIT_VIEW_ID_NONE', -1)
    define(tabs, 'TAB_ID_NONE', -1)
    define(tabs, 'TAB_INDEX_NONE', -1)
    Object.defineProperty(globalThis, '__voyagerTabsEventDispatch', {
      value: (details: ExtensionTabsEventDetails): void => {
        const listeners = tabsListeners.get(canonicalTabsEvent(details.event))
        if (!listeners) return
        for (const listener of [...listeners]) {
          try {
            listener(...details.args)
          } catch {
            // A broken extension listener must not break Voyager or other extensions.
          }
        }
      },
      configurable: true
    })
    if (!chrome.tabs) define(chrome, 'tabs', tabs)
  } catch (error) {
    console.warn('[voyager] Could not install chrome.tabs events:', error)
  }

  const openOptionsPage = (globalThis as any).__voyagerExtensionOpenOptionsPage
  if (typeof openOptionsPage === 'function') {
    try {
      const runtime = chrome.runtime ?? {}
      const open = (callback?: (opened: boolean) => void): Promise<boolean> => {
        const result = Promise.resolve(openOptionsPage()).then((opened) => opened === true)
        if (typeof callback === 'function') void result.then(callback)
        return result
      }
      if (define(runtime, 'openOptionsPage', open) && !chrome.runtime) {
        define(chrome, 'runtime', runtime)
      }
    } catch (error) {
      console.warn('[voyager] Could not install chrome.runtime.openOptionsPage shim:', error)
    }
  }

  const openPopup = (globalThis as any).__voyagerExtensionOpenPopup
  if (typeof openPopup === 'function') {
    try {
      const open = (
        detailsOrCallback?: unknown,
        maybeCallback?: (opened: boolean) => void
      ): Promise<boolean> => {
        const callback = (
          typeof detailsOrCallback === 'function'
            ? detailsOrCallback
            : typeof maybeCallback === 'function'
              ? maybeCallback
              : undefined
        ) as ((opened: boolean) => void) | undefined
        const result = Promise.resolve(openPopup()).then((opened: unknown) => opened === true)
        if (typeof callback === 'function') void result.then(callback)
        return result
      }
      const action = chrome.action ?? {}
      if (define(action, 'openPopup', open) && !chrome.action) define(chrome, 'action', action)
      const browserAction = chrome.browserAction ?? {}
      if (define(browserAction, 'openPopup', open) && !chrome.browserAction) {
        define(chrome, 'browserAction', browserAction)
      }
    } catch (error) {
      console.warn('[voyager] Could not install chrome.action.openPopup shim:', error)
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

  const privacyGet = (globalThis as any).__voyagerExtensionPrivacyGet
  const privacySet = (globalThis as any).__voyagerExtensionPrivacySet
  if (typeof privacyGet === 'function' && typeof privacySet === 'function') {
    try {
      const privacyListeners = new Set<(details: any) => void>()
      const emitPrivacy = (details: any): void => {
        for (const listener of [...privacyListeners]) {
          try {
            listener(details)
          } catch {
            // A broken extension listener must not break other listeners.
          }
        }
      }
      Object.defineProperty(globalThis, '__voyagerExtensionPrivacyChangeDispatch', {
        value: (payload: { key?: string; value?: unknown } | undefined): void => {
          if (payload?.key !== 'passwordSavingEnabled') return
          emitPrivacy({
            value: payload.value !== false,
            levelOfControl:
              payload.value === false
                ? 'controlled_by_this_extension'
                : 'controllable_by_this_extension'
          })
        },
        configurable: true
      })

      const setting = {
        get: (_options?: unknown, callback?: (details: any) => void): Promise<any> => {
          const result = Promise.resolve(privacyGet('passwordSavingEnabled')).then(
            (value: unknown) => ({
              value: value !== false,
              levelOfControl:
                value === false ? 'controlled_by_this_extension' : 'controllable_by_this_extension'
            })
          )
          if (typeof callback === 'function') void result.then(callback)
          return result
        },
        set: (details?: { value?: unknown }, callback?: () => void): Promise<void> => {
          const value = details?.value === true
          const result = Promise.resolve(privacySet('passwordSavingEnabled', value)).then(
            (granted: unknown) => {
              const runtime = chrome.runtime ?? {}
              if (granted === true) {
                try {
                  delete runtime.lastError
                } catch {
                  // Some bindings do not allow deleting their error field.
                }
              } else {
                define(runtime, 'lastError', {
                  message: 'Voyager did not allow this privacy setting change.'
                })
              }
            }
          )
          if (typeof callback === 'function') void result.then(callback)
          return result
        },
        onChange: {
          addListener(listener: (details: any) => void): void {
            privacyListeners.add(listener)
          },
          removeListener(listener: (details: any) => void): void {
            privacyListeners.delete(listener)
          },
          hasListener(listener: (details: any) => void): boolean {
            return privacyListeners.has(listener)
          }
        }
      }
      const privacy = chrome.privacy ?? {}
      const services = privacy.services ?? {}
      if (define(services, 'passwordSavingEnabled', setting) && !privacy.services) {
        define(privacy, 'services', services)
      }
      if (!chrome.privacy) define(chrome, 'privacy', privacy)
    } catch (error) {
      console.warn('[voyager] Could not install chrome.privacy shim:', error)
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

/**
 * Generic bridge for emulated Chrome APIs that Electron does not implement.
 * Unlike the one-off shims above, method lists, events, and constants come from
 * a serialized schema so each namespace only needs a main-process handler.
 */
const installExtensionApi = function installExtensionApi(
  schema: Record<string, ExtensionApiNode>
): void {
  const self = installExtensionApi as any
  self.attempts = (self.attempts ?? 0) + 1
  const chrome = (globalThis as any).chrome
  if (!chrome || typeof chrome !== 'object') {
    if (self.attempts < 500) setTimeout(() => installExtensionApi(schema), 10)
    return
  }

  const define = (target: any, key: string, value: any): void => {
    try {
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    } catch {
      try {
        target[key] = value
      } catch {
        // A frozen binding cannot accept an emulated member.
      }
    }
  }

  const browser =
    (globalThis as any).browser && typeof (globalThis as any).browser === 'object'
      ? (globalThis as any).browser
      : {}
  if (!(globalThis as any).browser) define(globalThis, 'browser', browser)

  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const events = new Map<string, any>()
  const bridgedListenerIds = new WeakMap<(...args: any[]) => void, string>()
  let nextListenerId = 0
  const eventKey = (path: string[], event: string): string => `${path.join('.')}.${event}`
  const makeEvent = (key: string, bridged = false, rules = false): any => {
    let event = events.get(key)
    if (event) return event
    const registered = new Set<(...args: any[]) => void>()
    listeners.set(key, registered)
    const notify = (method: string, args: unknown[]): void => {
      if (!bridged) return
      void makeMethod(key.split('.'), method, undefined)(...args)
    }
    const listenerId = (listener: (...args: any[]) => void): string | undefined => {
      if (typeof listener !== 'function') return undefined
      let id = bridgedListenerIds.get(listener)
      if (!id) {
        id = `${key}:${++nextListenerId}`
        bridgedListenerIds.set(listener, id)
      }
      return id
    }
    event = {
      addListener(listener: (...args: any[]) => void, ...options: unknown[]): void {
        if (typeof listener !== 'function') return
        registered.add(listener)
        if (bridged) {
          const id = listenerId(listener)
          if (id) notify('addListener', [id, ...options])
        }
      },
      removeListener(listener: (...args: any[]) => void): void {
        registered.delete(listener)
        if (bridged) {
          const id = listenerId(listener)
          if (id) notify('removeListener', [id])
        }
      },
      hasListener(listener: (...args: any[]) => void): boolean {
        const local = typeof listener === 'function' && registered.has(listener)
        if (bridged) {
          const id = listenerId(listener)
          if (id) notify('hasListener', [id])
        }
        return local
      },
      hasListeners(): boolean {
        if (bridged) notify('hasListeners', [])
        return registered.size > 0
      }
    }
    if (rules) {
      const path = key.split('.')
      define(event, 'addRules', makeMethod(path, 'addRules', undefined))
      define(event, 'removeRules', makeMethod(path, 'removeRules', undefined))
      define(event, 'getRules', makeMethod(path, 'getRules', { fallback: [] }))
    }
    events.set(key, event)
    return event
  }

  Object.defineProperty(globalThis, '__voyagerExtensionApiEventDispatch', {
    value: (payload: ExtensionApiEventPayload | undefined): void => {
      if (!payload || !Array.isArray(payload.path)) return
      const registered = listeners.get(eventKey(payload.path, payload.event))
      if (!registered) return
      const args = Array.isArray(payload.args) ? payload.args : []
      for (const listener of [...registered]) {
        try {
          listener(...args)
        } catch {
          // A broken extension listener must not break Voyager or other extensions.
        }
      }
    },
    configurable: true
  })

  const setLastError = (message: string): void => {
    const runtime = chrome.runtime ?? {}
    define(runtime, 'lastError', { message })
    if (!chrome.runtime) define(chrome, 'runtime', runtime)
    const extension = chrome.extension
    if (extension && typeof extension === 'object') {
      define(extension, 'lastError', { message })
    }
  }
  const clearLastError = (): void => {
    const runtime = chrome.runtime
    if (!runtime) return
    try {
      delete runtime.lastError
    } catch {
      // Some native bindings do not expose a deletable lastError field.
    }
  }

  const callBridge = (globalThis as any).__voyagerExtensionApiCall
  const makeMethod =
    (path: string[], method: string, definition?: ExtensionApiMethodDefinition) =>
    (...args: any[]): any => {
      clearLastError()
      const callback = args.find(
        (value): value is (...values: any[]) => void => typeof value === 'function'
      )
      const fallback = definition?.fallback
      if (definition?.synchronous) {
        if (callback) callback(fallback)
        return fallback
      }
      const payload: ExtensionApiCallRequest = {
        path,
        method,
        args: args.filter((value) => typeof value !== 'function')
      }
      const invoke = typeof callBridge === 'function' ? callBridge(payload) : undefined
      const result = Promise.resolve(invoke)
        .then((value) => {
          if (value === null || value === undefined) return fallback
          return value
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setLastError(message)
          return fallback
        })
      if (callback) void result.then(callback, () => callback(fallback))
      return result
    }

  const installNode = (root: any, path: string[], node: ExtensionApiNode): void => {
    let current = root
    for (const segment of path) {
      if (!current[segment] || typeof current[segment] !== 'object') {
        define(current, segment, {})
      }
      current = current[segment]
    }
    const fullPath = [...path]
    const preserve = node.preserveNative === true
    const fill = (key: string): boolean => !preserve || typeof current[key] === 'undefined'
    for (const [method, definition] of Object.entries(node.methods ?? {})) {
      if (fill(method)) define(current, method, makeMethod(fullPath, method, definition))
    }
    for (const event of node.events ?? []) {
      if (fill(event)) define(current, event, makeEvent(eventKey(fullPath, event)))
    }
    for (const event of node.bridgedEvents ?? []) {
      if (fill(event)) define(current, event, makeEvent(eventKey(fullPath, event), true))
    }
    for (const event of node.ruleEvents ?? []) {
      if (fill(event)) define(current, event, makeEvent(eventKey(fullPath, event), false, true))
    }
    for (const name of node.constructors ?? []) {
      if (!fill(name)) continue
      define(current, name, function (value?: unknown) {
        return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {}
      })
    }
    for (const [key, value] of Object.entries(node.constants ?? {})) {
      if (fill(key)) define(current, key, value)
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      installNode(root, [...fullPath, key], {
        ...child,
        preserveNative: child.preserveNative ?? preserve
      })
    }
  }

  for (const [name, node] of Object.entries(schema)) {
    installNode(chrome, [name], node)
    installNode(browser, [name], node)
  }

  // Native Electron APIs still need to be reachable through `browser`.
  // Chromium bindings are not always enumerable, so copy the known native
  // namespaces explicitly before falling back to structural mirroring.
  const nativeNamespaces = [
    'action',
    'browserAction',
    'pageAction',
    'permissions',
    'privacy',
    'runtime',
    'scripting',
    'tabs',
    'webNavigation'
  ]
  for (const name of nativeNamespaces) {
    try {
      const value = chrome[name]
      if (value && typeof value === 'object' && browser[name] === undefined) {
        define(browser, name, value)
      }
    } catch {
      // A native binding may not be readable in every extension context.
    }
  }
  const seen = new WeakSet<object>()
  const mirror = (target: any, source: any): void => {
    if (!source || typeof source !== 'object' || seen.has(source)) return
    seen.add(source)
    for (const key of Object.keys(source)) {
      const value = source[key]
      if (target[key] === undefined) {
        define(target, key, value)
        continue
      }
      if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') {
        mirror(target[key], value)
      }
    }
  }
  try {
    mirror(browser, chrome)
  } catch {
    // Native bindings can be opaque; schema APIs are already installed above.
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

  ipcRenderer.on(IpcChannels.ExtensionTabsEvent, (_event, details: ExtensionTabsEventDetails) => {
    const dispatch = (value: ExtensionTabsEventDetails): void => {
      const handler = (globalThis as any).__voyagerTabsEventDispatch
      if (handler) handler(value)
    }
    if (process.contextIsolated) {
      void contextBridge.executeInMainWorld({
        func: (value: ExtensionTabsEventDetails) => {
          const handler = (globalThis as any).__voyagerTabsEventDispatch
          if (handler) handler(value)
        },
        args: [details]
      })
    } else {
      dispatch(details)
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

  ipcRenderer.on(
    IpcChannels.ExtensionPrivacyChangedEvent,
    (_event, payload: { key: string; value: unknown }) => {
      const dispatch = (value: typeof payload): void => {
        const handler = (globalThis as any).__voyagerExtensionPrivacyChangeDispatch
        if (handler) handler(value)
      }
      if (process.contextIsolated) {
        void contextBridge.executeInMainWorld({
          func: (eventPayload: { key: string; value: unknown }) => {
            const handler = (globalThis as any).__voyagerExtensionPrivacyChangeDispatch
            if (handler) handler(eventPayload)
          },
          args: [payload]
        })
      } else {
        dispatch(payload)
      }
    }
  )

  ipcRenderer.on(IpcChannels.ExtensionApiEvent, (_event, payload: ExtensionApiEventPayload) => {
    const dispatch = (value: ExtensionApiEventPayload): void => {
      const handler = (globalThis as any).__voyagerExtensionApiEventDispatch
      if (handler) handler(value)
    }
    if (process.contextIsolated) {
      void contextBridge.executeInMainWorld({
        func: (eventPayload: ExtensionApiEventPayload) => {
          const handler = (globalThis as any).__voyagerExtensionApiEventDispatch
          if (handler) handler(eventPayload)
        },
        args: [payload]
      })
    } else {
      dispatch(payload)
    }
  })

  const createTabBridge = (details: ExtensionTabsCreateDetails): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionTabsCreate, null, details)
  const tabsCallBridge = (call: unknown): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionTabsCall, null, call)
  const openOptionsBridge = (): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionOpenOptionsPage, false)
  const openPopupBridge = (): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionActionOpenPopup, false)
  const permissionsBridge = (
    details: ExtensionPermissionsDetails & { mode?: string; checkOnly?: boolean }
  ): Promise<unknown> => {
    const fallback = details?.mode === 'getAll' ? { permissions: [], origins: [] } : false
    return safeInvoke(IpcChannels.ExtensionPermissionRequest, fallback, details)
  }
  const nativeConnectBridge = (hostName: string, portId: string): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionNativeConnect, null, hostName, portId)
  const nativePostBridge = (portId: string, message: unknown): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionNativePostMessage, false, portId, message)
  const nativeDisconnectBridge = (portId: string): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionNativeDisconnect, false, portId)
  const nativeSendBridge = (hostName: string, message: unknown): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionNativeSendMessage, null, hostName, message)
  const privacyGetBridge = (key: string): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionPrivacyGet, null, key)
  const privacySetBridge = (key: string, value: unknown): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionPrivacySet, false, key, value)
  const extensionApiBridge = (request: ExtensionApiCallRequest): Promise<unknown> =>
    safeInvoke(IpcChannels.ExtensionApiCall, undefined, request)

  const bridges: Record<string, (...args: any[]) => Promise<unknown>> = {
    [TABS_CREATE_BRIDGE]: createTabBridge,
    [TABS_CALL_BRIDGE]: tabsCallBridge,
    [OPEN_OPTIONS_BRIDGE]: openOptionsBridge,
    [ACTION_OPEN_POPUP_BRIDGE]: openPopupBridge,
    [PERMISSIONS_BRIDGE]: permissionsBridge,
    [NATIVE_CONNECT_BRIDGE]: nativeConnectBridge,
    [NATIVE_POST_BRIDGE]: nativePostBridge,
    [NATIVE_DISCONNECT_BRIDGE]: nativeDisconnectBridge,
    [NATIVE_SEND_BRIDGE]: nativeSendBridge,
    [PRIVACY_GET_BRIDGE]: privacyGetBridge,
    [PRIVACY_SET_BRIDGE]: privacySetBridge,
    [API_CALL_BRIDGE]: extensionApiBridge
  }
  if (process.contextIsolated) {
    for (const [key, value] of Object.entries(bridges)) {
      contextBridge.exposeInMainWorld(key, value)
    }
    void contextBridge.executeInMainWorld({ func: install })
    void contextBridge.executeInMainWorld({
      func: installExtensionApi,
      args: [EXTENSION_API_SCHEMA]
    })
  } else {
    // Service worker preload realms share the main world.
    for (const [key, value] of Object.entries(bridges)) {
      Object.defineProperty(globalThis, key, { value, configurable: true })
    }
    install()
    installExtensionApi(EXTENSION_API_SCHEMA)
  }
}
