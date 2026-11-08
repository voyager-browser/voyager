/**
 * Application-wide types shared between the main process, the chrome preload,
 * and the React chrome renderer.
 */

import type { SearchEngineId } from './search'
import type { FilterListId } from './filter-lists'

export type ThemeMode = 'system' | 'light' | 'dark'

/** Resolved theme: `mode` is the user preference, `dark` the effective scheme. */
export interface ThemeState {
  mode: ThemeMode
  dark: boolean
}

export interface AppVersionInfo {
  app: string
  electron: string
  chrome: string
  node: string
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
}

export interface BrowserState {
  tabs: TabState[]
  activeTabId: string | null
}

export interface NewTabRequest {
  url?: string
  active?: boolean
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

/** A synchronous `window.prompt()` waiting for a value in the chrome UI. */
export interface PromptRequest {
  id: string
  domain: string
  message: string
  defaultValue: string
}

/** Optional route passed when opening Settings from a site-info popover. */
export interface SettingsTarget {
  page?: 'site-permissions'
  origin?: string
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
  /** Imported hosts-format files stored locally. */
  customFilterFiles: CustomFilterFile[]
}

/** Site data categories cleared together from Settings. */
export interface ClearBrowsingDataOptions {
  cookies: boolean
  localStorage: boolean
  indexedDb: boolean
  cache: boolean
  sitePermissions: boolean
}
