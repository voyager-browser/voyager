/** Declarative description of the cross-platform Chrome APIs Voyager emulates. */
export interface ExtensionApiMethodDefinition {
  /** Value returned to callbacks/promises when the bridge is unavailable. */
  fallback?: unknown
}

export interface ExtensionApiNode {
  methods?: Record<string, ExtensionApiMethodDefinition>
  events?: string[]
  constants?: Record<string, unknown>
  properties?: Record<string, ExtensionApiNode>
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
  topSites: {
    methods: {
      get: { fallback: [] }
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
