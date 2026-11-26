/** Declarative description of the cross-platform Chrome APIs Voyager emulates. */
export interface ExtensionApiMethodDefinition {
  /** Value returned to callbacks/promises when the bridge is unavailable. */
  fallback?: unknown
}

export interface ExtensionApiNode {
  methods?: Record<string, ExtensionApiMethodDefinition>
  events?: string[]
  /** Events whose listener registration must also reach the main process. */
  bridgedEvents?: string[]
  constants?: Record<string, unknown>
  properties?: Record<string, ExtensionApiNode>
  /** Add only missing members so Electron's native bindings keep working. */
  preserveNative?: boolean
}

const contentSettingNode = (
  extra: Record<string, ExtensionApiMethodDefinition> = {}
): ExtensionApiNode => ({
  methods: {
    get: { fallback: {} },
    set: {},
    clear: {},
    getAll: { fallback: [] },
    ...extra
  },
  events: ['onSettingChanged']
})

export const EXTENSION_API_SCHEMA: Record<string, ExtensionApiNode> = {
  accessibilityFeatures: {
    properties: {
      animationPolicy: {
        methods: {
          get: {},
          set: {},
          clear: {}
        },
        events: ['onChange']
      }
    }
  },
  alarms: {
    methods: {
      create: {},
      get: {},
      getAll: {},
      clear: {},
      clearAll: {}
    },
    events: ['onAlarm']
  },
  bookmarks: {
    methods: {
      getTree: {},
      get: {},
      getChildren: {},
      getRecent: {},
      search: {},
      create: {},
      update: {},
      move: {},
      remove: {},
      removeTree: {}
    },
    events: ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']
  },
  browsingData: {
    methods: {
      removeData: {},
      removeDataType: {}
    }
  },
  cookies: {
    methods: {
      get: {},
      getAll: {},
      set: {},
      remove: {}
    },
    events: ['onChanged']
  },
  extension: {
    methods: {
      getURL: { fallback: '' },
      getManifest: { fallback: {} },
      getId: { fallback: '' },
      getExtension: { fallback: null },
      sendMessage: { fallback: false },
      isAllowedIncognitoAccess: { fallback: false },
      isAllowedFileSchemeAccess: { fallback: false }
    },
    events: ['onInstalled', 'onUpdateAvailable', 'onSuspend']
  },
  browserAction: {
    preserveNative: true,
    methods: {
      disable: {},
      enable: {},
      getBadgeBackgroundColor: { fallback: {} },
      getBadgeText: { fallback: '' },
      getPopup: { fallback: '' },
      getTitle: { fallback: '' },
      setBadgeBackgroundColor: {},
      setBadgeText: {},
      setIcon: {},
      setPopup: {},
      setTitle: {}
    },
    events: ['onClicked']
  },
  pageAction: {
    preserveNative: true,
    methods: {
      getPopup: { fallback: '' },
      getTitle: { fallback: '' },
      hide: {},
      setIcon: {},
      setPopup: {},
      setTitle: {},
      show: {}
    },
    events: ['onClicked']
  },
  runtime: {
    // Electron owns messaging and ports; only fill lifecycle gaps so the
    // worker can register listeners that it would otherwise crash on.
    preserveNative: true,
    methods: {
      getContexts: { fallback: [] }
    },
    events: ['onInstalled', 'onStartup', 'onSuspend', 'onSuspendCanceled']
  },
  declarativeNetRequest: {
    methods: {
      updateDynamicRules: {},
      getDynamicRules: { fallback: [] },
      updateSessionRules: {},
      getSessionRules: { fallback: [] },
      getEnabledRulesets: { fallback: [] },
      getAvailableStaticRulesets: { fallback: [] },
      updateStaticRules: {},
      getMatchedRules: { fallback: { matchedRules: [] } },
      isRegexSupported: { fallback: { isSupported: false } },
      getRuleConfiguration: { fallback: {} }
    },
    events: ['onRuleMatchedDebug']
  },
  contentSettings: {
    events: ['onSettingChanged'],
    properties: {
      cookies: contentSettingNode(),
      images: contentSettingNode(),
      javascript: contentSettingNode(),
      plugins: contentSettingNode({ getResourceIdentifiers: { fallback: [] } }),
      popups: contentSettingNode(),
      notifications: contentSettingNode(),
      geolocation: contentSettingNode(),
      microphone: contentSettingNode(),
      camera: contentSettingNode()
    }
  },
  history: {
    methods: {
      search: { fallback: [] },
      getVisits: { fallback: [] },
      addUrl: {},
      deleteUrl: {},
      deleteVisits: {},
      deleteAll: {},
      deleteRange: {}
    },
    events: ['onVisited', 'onVisitRemoved']
  },
  management: {
    methods: {
      getSelf: { fallback: null },
      getAll: { fallback: [] },
      get: { fallback: null },
      getPermissionWarningsById: { fallback: [] },
      getPermissionWarningsByManifest: { fallback: [] },
      setEnabled: {},
      uninstallSelf: {},
      launchUrl: {}
    },
    events: ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']
  },
  i18n: {
    methods: {
      getMessage: { fallback: '' },
      getLanguage: { fallback: 'en' },
      getUILanguage: { fallback: 'en' },
      getAcceptLanguages: { fallback: ['en'] }
    }
  },
  commands: {
    methods: {
      getAll: { fallback: [] }
    },
    events: ['onCommand']
  },
  contextMenus: {
    methods: {
      create: {},
      update: {},
      remove: {},
      removeAll: {},
      getAll: { fallback: [] }
    },
    events: ['onClicked', 'onRemoved']
  },
  downloads: {
    methods: {
      download: {},
      search: { fallback: [] },
      getFileIcon: { fallback: '' },
      open: { fallback: false },
      show: { fallback: false },
      pause: { fallback: false },
      resume: { fallback: false },
      canPause: { fallback: false },
      canResume: { fallback: false },
      cancel: { fallback: false },
      removeFile: {},
      erase: {}
    },
    events: ['onCreated', 'onChanged', 'onErased']
  },
  notifications: {
    methods: {
      create: { fallback: '' },
      update: { fallback: false },
      clear: { fallback: false },
      getAll: { fallback: [] },
      getPermissionLevel: { fallback: 'denied' }
    },
    events: ['onClicked', 'onClosed', 'onButtonClicked', 'onPermissionLevelChanged']
  },
  tts: {
    methods: {
      speak: { fallback: false },
      stop: {},
      pause: {},
      resume: {},
      isSpeaking: { fallback: false },
      getVoices: { fallback: [] }
    },
    events: ['onStart', 'onEnd', 'onWordBoundary', 'onError']
  },
  tabGroups: {
    constants: { TAB_GROUP_ID_NONE: -1 },
    methods: {
      get: { fallback: null },
      getAll: { fallback: [] },
      query: { fallback: [] },
      update: { fallback: null },
      move: { fallback: null }
    },
    events: ['onCreated', 'onUpdated', 'onMoved', 'onRemoved']
  },
  topSites: {
    methods: {
      get: { fallback: [] }
    }
  },
  permissions: {
    // Electron owns permission prompts; keep its methods and add only the
    // lifecycle events its MV3 bindings can omit.
    preserveNative: true,
    methods: {
      request: {},
      contains: { fallback: false },
      getAll: { fallback: { permissions: [], origins: [] } },
      remove: {}
    },
    events: ['onAdded', 'onRemoved', 'onChanged']
  },
  offscreen: {
    // An offscreen document cannot run in this build, but callers still need
    // the enum and callable methods so worker bootstrap does not throw.
    preserveNative: true,
    constants: {
      Reason: {
        AUDIO_CAPTURE: 'AUDIO_CAPTURE',
        CLIPBOARD: 'CLIPBOARD',
        LOCAL_STORAGE: 'LOCAL_STORAGE',
        VIDEO_CAPTURE: 'VIDEO_CAPTURE'
      }
    },
    methods: {
      createDocument: {},
      closeDocument: {},
      hasDocument: { fallback: false }
    }
  },
  sidePanel: {
    preserveNative: true,
    methods: {
      open: {},
      setOptions: {},
      getOptions: { fallback: {} },
      setPanelBehavior: {},
      getPanelBehavior: { fallback: {} }
    },
    events: ['onPanelOptionsChanged']
  },
  scripting: {
    preserveNative: true,
    constants: {
      ExecutionWorld: { ISOLATED: 'ISOLATED', MAIN: 'MAIN' }
    },
    methods: {
      executeScript: { fallback: [] },
      insertCSS: {},
      removeCSS: {},
      registerContentScripts: {},
      unregisterContentScripts: {},
      getRegisteredContentScripts: { fallback: [] },
      updateContentScripts: {}
    }
  },
  proxy: {
    methods: {
      set: {},
      clear: {},
      get: { fallback: { value: { mode: 'direct' }, levelOfControl: 'not_controllable' } }
    },
    events: ['onProxyError']
  },
  search: {
    methods: {
      query: {}
    }
  },
  sessions: {
    methods: {
      getRecentlyClosed: { fallback: [] },
      getSessions: { fallback: [] },
      restore: { fallback: {} }
    }
  },
  windows: {
    constants: { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 },
    methods: {
      get: { fallback: null },
      getAll: { fallback: [] },
      getCurrent: { fallback: null },
      getLastFocused: { fallback: null },
      create: { fallback: null },
      update: { fallback: null },
      remove: {}
    },
    events: ['onCreated', 'onRemoved', 'onFocusChanged']
  },
  webRequest: {
    methods: {
      handlerBehaviorChanged: {},
      handlerResult: {}
    },
    bridgedEvents: [
      'onBeforeRequest',
      'onBeforeSendHeaders',
      'onSendHeaders',
      'onHeadersReceived',
      'onCompleted',
      'onErrorOccurred'
    ],
    // Electron cannot surface redirects or auth challenges, but extensions
    // still register listeners for them during service-worker bootstrap.
    events: ['onBeforeRedirect', 'onAuthRequired']
  },
  idle: {
    methods: {
      setDetectionInterval: {},
      getState: { fallback: 'active' },
      queryState: { fallback: 'active' }
    },
    events: ['onStateChanged']
  },
  system: {
    properties: {
      cpu: {
        methods: {
          getInfo: { fallback: { processors: 0, model: '', speed: 0 } }
        },
        events: ['onUpdated']
      },
      display: {
        methods: {
          getInfo: { fallback: [] },
          getMetrics: { fallback: {} },
          setBrightness: { fallback: false },
          clearBrightness: {},
          enableUnifiedDesktop: { fallback: false }
        },
        events: ['onDisplayChanged']
      },
      memory: {
        methods: {
          getInfo: { fallback: { capacity: 0, availableCapacity: 0 } }
        }
      }
    }
  },
  storage: {
    events: ['onChanged'],
    properties: {
      local: {
        methods: {
          get: { fallback: {} },
          getBytesInUse: { fallback: 0 },
          set: {},
          remove: {},
          clear: {}
        }
      },
      sync: {
        methods: {
          get: { fallback: {} },
          getBytesInUse: { fallback: 0 },
          set: {},
          remove: {},
          clear: {}
        }
      },
      session: {
        methods: {
          get: { fallback: {} },
          getBytesInUse: { fallback: 0 },
          set: {},
          remove: {},
          clear: {}
        }
      },
      managed: {
        methods: {
          get: { fallback: {} },
          getBytesInUse: { fallback: 0 }
        }
      }
    }
  }
}

/** Renderer-to-main request for one emulated extension API call. */
export interface ExtensionApiCallRequest {
  path: string[]
  method: string
  args: unknown[]
}

/** Main-to-renderer notification for one emulated extension API event. */
export interface ExtensionApiEventPayload {
  path: string[]
  event: string
  args: unknown[]
  /** Deliver only to the owning extension when an event is extension-specific. */
  extensionId?: string
}
