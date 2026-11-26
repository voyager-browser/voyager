import type { ExtensionPermissionChoice, PermissionKind, PermissionRequestChoice } from './types'

/** Every category in the order Settings and prompts should present them. */
export const PERMISSION_KINDS: readonly PermissionKind[] = [
  'geolocation',
  'notifications',
  'camera',
  'microphone',
  'camera-microphone',
  'clipboard-read',
  'display-capture',
  'midi',
  'device-access',
  'other'
]

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  geolocation: 'Location',
  notifications: 'Notifications',
  camera: 'Camera',
  microphone: 'Microphone',
  'camera-microphone': 'Camera and microphone',
  'clipboard-read': 'Clipboard',
  'display-capture': 'Screen sharing',
  midi: 'MIDI devices',
  'device-access': 'Connected devices',
  other: 'Other permissions'
}

/** Short verb phrase shown beside the requesting site in a prompt. */
export const PERMISSION_ACTIONS: Record<PermissionKind, string> = {
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  'camera-microphone': 'Use your camera and microphone',
  'clipboard-read': 'See text and images copied to the clipboard',
  'display-capture': 'Share your screen',
  midi: 'Use your MIDI devices',
  'device-access': 'Connect to a device',
  other: 'Use this permission'
}

export function isPermissionKind(value: unknown): value is PermissionKind {
  return typeof value === 'string' && (PERMISSION_KINDS as readonly string[]).includes(value)
}

/**
 * Chrome-style warnings for MV3 and MV2 manifest permissions. Keys without an
 * official install warning use the plain-language equivalent from the Chrome
 * Developer permission reference so the consent list never shows a raw API name.
 */
export const EXTENSION_PERMISSION_LABELS: Record<string, string[]> = {
  'accessibilityFeatures.modify': ['Change your accessibility settings'],
  'accessibilityFeatures.read': ['Read your accessibility settings'],
  activeTab: ['Access the active tab when you click the extension'],
  alarms: ['Schedule tasks to run at specific times'],
  audio: ['Read and change your audio device settings'],
  background: ['Run in the background when Voyager starts'],
  bookmarks: ['Read and change your bookmarks'],
  browsingData: ['Clear your browsing data'],
  certificateProvider: ['Manage certificates for network connections'],
  clipboardRead: ['Read data you copy and paste'],
  clipboardWrite: ['Modify data you copy and paste'],
  contentSettings: [
    "Change your settings that control websites' access to features such as cookies, JavaScript, plugins, geolocation, microphone, camera etc."
  ],
  contextMenus: ['Add items to context menus'],
  cookies: ['Read and change your cookies'],
  debugger: ['Access the page debugger backend', 'Read and change all your data on all websites'],
  declarativeContent: ['Read page content to decide when to show your extension'],
  declarativeNetRequest: ['Block content on any page'],
  declarativeNetRequestFeedback: ['Read your browsing history'],
  declarativeNetRequestWithHostAccess: ['Block content on websites you grant access to'],
  declarativeWebRequest: ['Block or modify network requests on websites you grant access to'],
  desktopCapture: ['Capture content of your screen'],
  dns: ['Resolve domain names through DNS'],
  documentScan: ['Scan documents with your scanner'],
  downloads: ['Manage your downloads'],
  'downloads.open': ['Manage your downloads'],
  'downloads.ui': ['Manage your downloads'],
  'enterprise.deviceAttributes': ['Read your device attributes'],
  'enterprise.hardwarePlatform': ['Read your hardware platform information'],
  'enterprise.networkingAttributes': ['Read your network information'],
  'enterprise.platformKeys': ['Manage enterprise platform keys'],
  favicon: ['Read the icons of the websites you visit'],
  fileBrowserHandler: ['Handle files opened from the file browser'],
  fileSystemProvider: ['Manage files and folders on your device'],
  fontSettings: ['Change your font settings'],
  gcm: ['Receive push messages'],
  geolocation: ['Detect your physical location'],
  history: ['Read and change your browsing history on all signed-in devices'],
  identity: ['Access your account identity'],
  'identity.email': ['Know your email address'],
  idle: ['Detect when your computer is idle, locked, or active'],
  loginState: ['Read your operating system login state'],
  management: ['Manage your apps, extensions, and themes'],
  nativeMessaging: ['Communicate with cooperating native applications'],
  notifications: ['Display notifications'],
  offscreen: ['Create hidden documents in the background'],
  pageCapture: ['Read and change all your data on all websites'],
  platformKeys: ['Manage platform keys'],
  power: ['Keep your screen or system awake'],
  printerProvider: ['Manage printers'],
  printing: ['Print pages'],
  printingMetrics: ['Read your printing history'],
  privacy: ['Change your privacy-related settings'],
  'privacy.passwordSavingEnabled': ["Turn off Voyager's password saving"],
  processes: ['View running extension processes'],
  proxy: ['Read and change all your data on all websites'],
  publicSuffix: ['Read public suffix rules'],
  readingList: ['Read and change entries in the reading list'],
  runtime: ['Communicate with cooperating native applications'],
  scripting: ['Read and change site content'],
  search: ['Search using your default search engine'],
  sessions: ['Read your browsing history on all your signed-in devices'],
  sidePanel: ['Show a side panel next to web pages'],
  storage: ['Store extension data'],
  'system.cpu': ['Read information about your computer processor'],
  'system.display': ['Read and change display settings'],
  'system.memory': ['Read information about your computer memory'],
  'system.storage': ['Identify and eject storage devices'],
  tabCapture: ['Read and change all your data on all websites'],
  tabGroups: ['View and manage your tab groups'],
  tabs: ['Read your browsing history'],
  topSites: ['Read a list of your most frequently visited websites'],
  tts: ['Speak text using synthesized speech'],
  ttsEngine: ['Read all text spoken using synthesized speech'],
  unlimitedStorage: ['Store unlimited data on your device'],
  userScripts: ['Run user scripts on websites you grant access to'],
  vpnProvider: ['Manage VPN connections'],
  webAuthenticationProxy: ['Read and change all your data on all websites'],
  webNavigation: ['Read your browsing history'],
  webRequest: ['Observe network requests as they happen'],
  webRequestAuthProvider: ['Handle HTTP authentication requests'],
  webRequestBlocking: ['Block and modify network requests before they are sent']
}

const ALL_SITES_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'])

function hostPatternLabel(value: string): string {
  if (ALL_SITES_PATTERNS.has(value)) {
    return 'Read and change all your data on the websites you visit'
  }
  let host = value
  try {
    host = new URL(value).host || value
  } catch {
    host = value.replace(/^\*:\/\//, '').replace(/\/.*$/, '')
  }
  return `Read and change your data on ${host}`
}

/** Every plain-language warning for one manifest permission or host pattern. */
export function extensionPermissionLabels(permission: string): string[] {
  const value = permission.startsWith('origin:') ? permission.slice('origin:'.length) : permission
  if (value === '<all_urls>' || value.includes('://')) return [hostPatternLabel(value)]
  return EXTENSION_PERMISSION_LABELS[permission] ?? [`Use the ${permission} permission`]
}

export function extensionPermissionLabel(permission: string): string {
  return extensionPermissionLabels(permission)[0] ?? `Use the ${permission} permission`
}

export function isExtensionPermissionChoice(value: unknown): value is ExtensionPermissionChoice {
  return value === 'allow' || value === 'block' || value === 'dismiss'
}

export function isPermissionRequestChoice(value: unknown): value is PermissionRequestChoice {
  return (
    value === 'allow-site' || value === 'allow-once' || value === 'block' || value === 'dismiss'
  )
}

/** Normalize a URL/origin into a site origin, rejecting opaque/file origins. */
export function permissionOriginForUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Human-readable host for an origin, used in prompts and Settings. */
export function permissionHostForOrigin(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}
