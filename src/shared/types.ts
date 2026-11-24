/**
 * Application-wide types shared between the main process, the chrome preload,
 * and the React chrome renderer.
 */

import type { ProfileInfo } from './profiles'
import type { ProxyMode, ProxyScheme } from './proxy'
import type { SearchEngineId } from './search'
import type { FilterListId } from './filter-lists'

export type ThemeMode = 'system' | 'light' | 'dark'

/** Colors the chrome renderer exposes as CSS variables. */
export type ThemeColorKey = 'background' | 'foreground' | 'accent' | 'border' | 'muted' | 'surface'

export type BrowserThemeColors = Record<ThemeColorKey, string>

/** Where a browser theme came from, used by Settings and reset behavior. */
export type BrowserThemeSource =
  'default' | 'custom' | 'chrome-crx' | 'chrome-manifest' | 'chrome-store' | 'chrome-extension'

/** Per-profile chrome theme. Images are URLs served from the profile's theme directory. */
export interface BrowserTheme {
  id: string
  name: string
  source: BrowserThemeSource
  colors: BrowserThemeColors
  backgroundImage?: string
  version?: string
  importedAt?: number
}

export type StartPageBackgroundKind = 'default' | 'color' | 'image'

/** Per-profile New Tab background, independent from the chrome palette. */
export interface StartPageBackground {
  kind: StartPageBackgroundKind
  color?: string
  image?: string
}

/** A file selected in Settings and forwarded to the main process for import. */
export interface ThemeFileInput {
  name: string
  mimeType: string
  /** Base64-encoded file contents (without a data URL prefix). */
  data: string
}

export type ThemeColorPatch = Partial<BrowserThemeColors>

export interface ThemeStartPageInput {
  kind: StartPageBackgroundKind
  color?: string
  image?: ThemeFileInput
}

/** Resolved theme: `mode` is app-wide, chrome/start-page data is per profile. */
export interface ThemeState {
  mode: ThemeMode
  dark: boolean
  chrome: BrowserTheme
  startPage: StartPageBackground
}

export interface AppVersionInfo {
  app: string
  electron: string
  chrome: string
  node: string
  dev: boolean
}

/** Callback signature returned by event subscription APIs. */
export type Unsubscribe = () => void

/* ---- Browser / tabs ---------------------------------------------------- */

export interface TabState {
  id: string
  title: string
  url: string
  loading: boolean
  favicon: string | null
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  muted: boolean
  hasAudio: boolean
  crashed: boolean
  /** True when the tab has been unloaded by Memory Saver and will reload on activate. */
  discarded?: boolean
}

export interface BrowserState {
  tabs: TabState[]
  activeTabId: string | null
  /** Secondary tab shown beside the active tab in split view, or null. */
  splitTabId?: string | null
}

export interface NewTabRequest {
  url?: string
  active?: boolean
  /** Zero-based insertion position; omit to append to the end. */
  index?: number
}

/* ---- TLS certificates -------------------------------------------------- */

export interface CertificateChainEntry {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  fingerprint256: string
  isCA: boolean
}

/** Details of the leaf certificate served by an HTTPS site. */
export interface CertificateDetails {
  url: string
  host: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  serialNumber: string
  /** SHA-1 fingerprint. */
  fingerprint: string
  /** SHA-256 fingerprint. */
  fingerprint256: string
  /** SHA-512 fingerprint. */
  fingerprint512: string
  publicKey: string
  subjectAltName: string
  keyUsage: string
  isCA: boolean
  /** Leaf-to-root chain reported by the TLS handshake. */
  chain: CertificateChainEntry[]
  /** PEM-encoded leaf certificate. */
  pem: string
}

export type CertificateExportFormat = 'pem' | 'der'

export interface NewBookmarkInput {
  title: string
  url: string
  favicon?: string | null
  /** Folder to add the bookmark to. Omit or null for the bookmarks bar root. */
  folderId?: string | null
}

/* ---- Site permissions -------------------------------------------------- */

/**
 * Browser-level permission categories. Electron reports raw Chromium
 * permission names; these are the stable categories shown in prompts and
 * Settings.
 */
export type PermissionKind =
  | 'geolocation'
  | 'notifications'
  | 'camera'
  | 'microphone'
  | 'camera-microphone'
  | 'clipboard-read'
  | 'display-capture'
  | 'midi'
  | 'device-access'
  | 'other'

export type PermissionDecision = 'allow' | 'block'

export interface SitePermissionDecision {
  origin: string
  kind: PermissionKind
  decision: PermissionDecision
  updatedAt: number
}

export interface SitePermissionsState {
  decisions: SitePermissionDecision[]
  /** Decisions recently removed by the auto-removal privacy policy (undoable). */
  autoRemovedDecisions?: SitePermissionDecision[]
}

export type PermissionRequestChoice = 'allow-site' | 'allow-once' | 'block' | 'dismiss'

export interface PermissionPromptRequest {
  id: string
  origin: string
  host: string
  kind: PermissionKind
  tabId: string | null
}

export interface PermissionPromptCancelled {
  id: string
}

export type ExtensionPermissionChoice = 'allow' | 'block' | 'dismiss'

export interface ExtensionPermissionRequest {
  id: string
  extensionId: string
  extensionName: string
  permissions: string[]
  origins: string[]
}

/** A native application that an extension is allowed to exchange messages with. */
export interface NativeMessagingHost {
  name: string
  /** Absolute path to an executable that speaks the native messaging protocol. */
  path: string
  /** Chrome-style extension origins, e.g. `chrome-extension://abcdef/`. */
  allowedOrigins: string[]
  description?: string
}

export interface ExtensionNativeMessage {
  portId: string
  message: unknown
}

export interface ExtensionNativeDisconnect {
  portId: string
}

/** A synchronous `window.prompt()` waiting for a value in the chrome UI. */
export interface PromptRequest {
  id: string
  domain: string
  message: string
  defaultValue: string
}

/** Optional route passed when opening Settings from a site-info popover. */
export interface SettingsTarget {
  page?: 'site-permissions' | 'profiles'
  origin?: string
}

/** Per-window state shown to the chrome renderer. */
export interface WindowState {
  incognito: boolean
  profile: ProfileInfo
  maximized: boolean
}

export interface NewBookmarkFolderInput {
  title: string
  parentId?: string | null
}

export type BookmarkNodeKind = 'bookmark' | 'folder'

export interface BookmarkItem {
  id: string
  title: string
  url: string
  favicon?: string | null
  /** Containing folder, or null when the bookmark lives on the bar root. */
  folderId: string | null
  createdAt: number
}

export interface BookmarkFolder {
  id: string
  title: string
  parentId: string | null
  createdAt: number
}

export interface BookmarkPatch {
  title?: string
  url?: string
}

export interface BookmarkFolderPatch {
  title?: string
}

export interface BookmarkMoveInput {
  kind: BookmarkNodeKind
  id: string
  parentId: string | null
  /** Insert before this sibling; null appends to the end of the folder. */
  beforeId?: string | null
}

export interface BookmarkClipboard {
  mode: 'copy' | 'cut'
  kind: BookmarkNodeKind
  id: string
  /** Profile that owns the node referenced by `id`. */
  sourceProfileId: string
}

export interface BookmarksState {
  items: BookmarkItem[]
  folders: BookmarkFolder[]
  barVisible: boolean
  clipboard: BookmarkClipboard | null
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
}

export interface HistoryState {
  entries: HistoryEntry[]
}

export interface DownloadItem {
  id: string
  url: string
  filename: string
  receivedBytes: number
  totalBytes: number
  state: 'progressing' | 'completed' | 'interrupted' | 'cancelled'
  paused?: boolean
  path?: string
  startTime: number
  endTime?: number
}

export interface DownloadsState {
  items: DownloadItem[]
}

/** User preferences exposed to the settings window. */
/** A user-imported hosts-format filter file (stored locally, not fetched). */
export interface CustomFilterFile {
  id: string
  name: string
  addedAt: number
}

/** A hostname and how many requests to it were blocked. */
export interface ContentBlockingHostCount {
  host: string
  count: number
}

/** Live tracker-blocking activity for the active profile. */
export interface ContentBlockingStats {
  /** Whether tracker blocking is enabled for the profile. */
  enabled: boolean
  /** Requests blocked across the whole profile session. */
  sessionBlocked: number
  /** Busiest blocked hosts for the whole session, highest first. */
  topHosts: ContentBlockingHostCount[]
  /** Requests blocked on the active page, when requested from a browser window. */
  pageBlocked: number
  /** Busiest blocked hosts for the active page, highest first. */
  pageHosts: ContentBlockingHostCount[]
  /** Hostname of the active page, when known. */
  site: string | null
  /** False when tracker blocking is turned off for the active site. */
  siteEnabled: boolean
  /** Hostnames where tracker blocking is turned off. */
  exceptions: string[]
}

/** How an extension can currently interact with the active site. */
export type ExtensionHostAccess = 'full' | 'request' | 'none'

/** User's per-extension site-access choice, mirroring Chrome's menu. */
export type ExtensionSiteAccess = 'click' | 'site' | 'all'

/** Toolbar action declared by an extension manifest. */
export interface ExtensionActionInfo {
  /** Manifest-relative popup document, when the action has one. */
  popup: string | null
  title: string
  /** Manifest-relative icon path, when one is declared. */
  icon: string | null
  /** Absolute chrome-extension URL for the icon, ready for an <img>. */
  iconUrl: string | null
}

/** An unpacked extension loaded for a profile. */
export interface ExtensionInfo {
  /** Chrome-assigned id; null when the stored path failed to load. */
  id: string | null
  name: string
  version: string
  path: string
  loaded: boolean
  action: ExtensionActionInfo | null
  /** Category used to group this extension in the action menu. */
  hostAccess: ExtensionHostAccess
  /** Whether the extension's action is pinned to the toolbar. */
  pinned: boolean
  /** Current site-access choice for this extension. */
  siteAccess: ExtensionSiteAccess
}

/** Outcome of an automatic or manual extension update check. */
export interface ExtensionUpdateResult {
  name: string
  fromVersion: string
  toVersion?: string
  status: 'updated' | 'up-to-date' | 'skipped' | 'failed'
  message?: string
}

export interface UserPreferences {
  clearHistory: boolean
  clearDownloads: boolean
  clearBookmarks: boolean
  clearCookies: boolean
  clearLocalStorage: boolean
  clearIndexedDb: boolean
  clearCache: boolean
  clearSitePermissions: boolean
  openDownloadsWhenDone: boolean
  /** Active search engine; incognito windows fall back to the default. */
  searchEngine?: SearchEngineId
  /** Reopen the tabs from the previous session on startup (default off). */
  restoreSession: boolean
  /** Show tabs in a vertical rail instead of the horizontal tab strip. */
  verticalTabs: boolean
  /** Cancel requests to known ad/tracker domains before they hit the network. */
  contentBlocking: boolean
  /** Include Voyager's bundled domain list when content blocking is enabled. */
  builtinFilterList: boolean
  /** Optional hosts-format catalog filter lists enabled by the user. */
  filterLists: FilterListId[]
  /** Custom hosts-format list URLs (http/https) added by the user. */
  customFilterLists: string[]
  /** Why a custom list could not be applied, by normalized URL. */
  customFilterListErrors: Record<string, string>
  /** Imported hosts-format files stored locally. */
  customFilterFiles: CustomFilterFile[]
  /** Hostnames where tracker blocking is turned off. */
  contentBlockingExceptions: string[]
  /** Proxy mode for this profile. */
  proxyMode: ProxyMode
  /** Proxy scheme when using a fixed proxy server. */
  proxyScheme: ProxyScheme
  /** Proxy host when using a fixed proxy server. */
  proxyHost: string
  /** Proxy port when using a fixed proxy server. */
  proxyPort: number
  /** Comma/newline-separated bypass rules for fixed proxy mode. */
  proxyBypassRules: string
  /** Enable the built-in spell checker for page content (default on). */
  spellcheck: boolean
  /** Show a Home button in the toolbar (default off). */
  showHomeButton: boolean
  /** URL opened by the Home button. */
  homeUrl: string
  /** Unload inactive tabs to save memory; they reload when activated. */
  memorySaver: boolean
  /** Show developer-oriented features in the menu. */
  developerMode: boolean
  /** Custom User-Agent string; empty uses the default. */
  userAgent: string
  /** Prefetch/preload top sites to warm DNS and cache (uses network in background). */
  preloadTopSites: boolean
  /** Save and offer address/contact autofill on forms. */
  autofillProfiles: boolean
  /** Save and offer payment method autofill on forms. */
  autofillPayments: boolean
  /** Save form field values and offer autocomplete suggestions. */
  saveFormHistory: boolean
}

/** A saved address for autofill. */
export interface AutofillAddress {
  id: string
  label?: string
  name: string
  organization?: string
  streetAddress: string
  streetAddress2?: string
  city: string
  region?: string
  postalCode: string
  country: string
  phone?: string
  email?: string
  updatedAt: number
}

/** A saved contact for autofill. */
export interface AutofillContact {
  id: string
  name: string
  email?: string
  phone?: string
  organization?: string
  updatedAt: number
}

/** A saved payment method for autofill (card details stored locally). */
export interface AutofillPaymentMethod {
  id: string
  nameOnCard: string
  cardNumber: string
  expiryMonth: string
  expiryYear: string
  cardType?: string
  updatedAt: number
}

/** A remembered form field value for autocomplete suggestions. */
export interface FormHistoryEntry {
  id: string
  /** Normalized field name/key used for matching. */
  field: string
  value: string
  /** Number of times this value was submitted. */
  count: number
  updatedAt: number
}

export interface AutofillState {
  addresses: AutofillAddress[]
  contacts: AutofillContact[]
  paymentMethods: AutofillPaymentMethod[]
  formHistory: FormHistoryEntry[]
}

/** Site data categories cleared together from Settings. */
export interface ClearBrowsingDataOptions {
  cookies: boolean
  localStorage: boolean
  indexedDb: boolean
  cache: boolean
  sitePermissions: boolean
  formHistory?: boolean
  autofillData?: boolean
}
