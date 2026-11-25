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
}
