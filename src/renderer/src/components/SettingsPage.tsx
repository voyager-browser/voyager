import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Info,
  MapPin,
  Palette,
  Pencil,
  Plus,
  Power,
  Puzzle,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  UserCircle2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useHistoryStore } from '../state/historyStore'
import { useDownloadsStore } from '../state/downloadsStore'
import { useTheme } from './providers/theme-context'
import { useBrowserStore } from '../state/browserStore'
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from '../../../shared/search'
import { DEFAULT_FILTER_LISTS, FILTER_LISTS } from '../../../shared/filter-lists'
import { DEFAULT_NEW_TAB_URL } from '../../../shared/constants'
import { DEFAULT_PROXY_CONFIG, type ProxyMode, type ProxyScheme } from '../../../shared/proxy'
import type {
  AppVersionInfo,
  AutofillAddress,
  AutofillContact,
  AutofillPaymentMethod,
  AutofillState,
  ContentBlockingStats,
  ExtensionInfo,
  NativeMessagingHost,
  ThemeMode,
  UserPreferences
} from '../../../shared/types'
import { BUILTIN_BLOCKED_DOMAINS } from '../../../shared/content-blocking'
import { DEFAULT_PROFILE_ID, type ProfileInfo, type ProfilesState } from '../../../shared/profiles'
import { SitePermissionsSettings } from './SitePermissionsSettings'
import { ThemeSettings } from './ThemeSettings'

function sitePermissionsRoute(): { open: boolean; origin?: string } {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.startsWith('site-permissions')) return { open: false }
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const origin = new URLSearchParams(query).get('origin') ?? undefined
  return { open: true, origin }
}

function profilesRoute(): boolean {
  return window.location.hash.replace(/^#/, '') === 'profiles'
}

interface SettingsNavItem {
  id: string
  label: string
  icon: LucideIcon
  children?: Array<{ id: string; label: string }>
}

/** Sidebar groups mirror Chrome's settings navigation and follow content order. */
const SETTINGS_NAV_GROUPS: SettingsNavItem[][] = [
  [
    { id: 'profiles', label: 'Profiles', icon: UserCircle2 },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'startup', label: 'On startup', icon: Power },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'content-blocking', label: 'Content blocking', icon: Shield },
    { id: 'privacy-dashboard', label: 'Privacy dashboard', icon: ShieldCheck }
  ],
  [
    {
      id: 'privacy',
      label: 'Privacy and security',
      icon: ShieldCheck,
      children: [{ id: 'site-permissions', label: 'Site permissions' }]
    },
    { id: 'autofill', label: 'Autofill', icon: FileText },
    { id: 'proxy', label: 'Proxy', icon: Globe },
    { id: 'downloads', label: 'Downloads', icon: Download },
    { id: 'clear-browsing-data', label: 'Clear browsing data', icon: Trash2 },
    { id: 'data', label: 'Data', icon: Database }
  ],
  [
    { id: 'developer', label: 'Developer', icon: Wrench },
    { id: 'extensions', label: 'Extensions', icon: Puzzle },
    { id: 'about', label: 'About', icon: Info }
  ]
]

const BUG_REPORT_BODY = `# Bug

## Details

Give a thorough explanation of your bug.

### Reproduce

Give the steps to reproduce in this order, it can be as many steps as you want.

1. Step 1
2. Step 2
3. Step 3

## Checklist

### Questions

- [ ] Have you tested this on the stable build of Voyager?
- [ ] Have you tested this on the developer build of Voyager?
- [x] Did you use the "report bug" button in Voyager?

### Is this a...

- [x] Bug? _(an unexpected problem or behavior)_
- [ ] Feature? _(an idea you'd like to see in Voyager)_
- [ ] Task? _(a specific task of work)_
`

/** Pre-filled GitHub issue used by the About section's report-bug button. */
function reportBugUrl(): string {
  const params = new URLSearchParams({
    assignees: 'Infinite1024Void',
    labels: 'bug',
    type: 'bug',
    body: BUG_REPORT_BODY
  })
  return `https://github.com/voyager-browser/voyager/issues/new?${params.toString()}`
}

export function SettingsPage(): React.JSX.Element {
  const { mode, setMode } = useTheme()
  const bookmarks = useBookmarksStore((state) => state.items)
  const history = useHistoryStore((state) => state.entries)
  const downloads = useDownloadsStore((state) => state.items)
  const searchEngine = useBrowserStore((state) => state.searchEngine)
  const setSearchEngine = useBrowserStore((state) => state.setSearchEngine)
  const [preferences, setPreferences] = useState<UserPreferences>({
    clearHistory: true,
    clearDownloads: true,
    clearBookmarks: false,
    clearCookies: true,
    clearLocalStorage: true,
    clearIndexedDb: true,
    clearCache: true,
    clearSitePermissions: true,
    openDownloadsWhenDone: false,
    restoreSession: false,
    verticalTabs: false,
    contentBlocking: false,
    builtinFilterList: true,
    filterLists: [...DEFAULT_FILTER_LISTS],
    customFilterLists: [],
    customFilterListErrors: {},
    customFilterFiles: [],
    contentBlockingExceptions: [],
    proxyMode: DEFAULT_PROXY_CONFIG.mode,
    proxyScheme: DEFAULT_PROXY_CONFIG.scheme,
    proxyHost: DEFAULT_PROXY_CONFIG.host,
    proxyPort: DEFAULT_PROXY_CONFIG.port,
    proxyBypassRules: DEFAULT_PROXY_CONFIG.bypassRules,
    spellcheck: true,
    showHomeButton: false,
    homeUrl: DEFAULT_NEW_TAB_URL,
    memorySaver: false,
    developerMode: false,
    userAgent: '',
    preloadTopSites: false,
    autofillProfiles: true,
    autofillPayments: true,
    saveFormHistory: true
  })
  const [customFilterUrl, setCustomFilterUrl] = useState('')
  const [customFilterError, setCustomFilterError] = useState<string | null>(null)
  const [importingFilterFile, setImportingFilterFile] = useState(false)
  const [blockingStats, setBlockingStats] = useState<ContentBlockingStats | null>(null)
  const [clearing, setClearing] = useState(false)
  const [initialRoute] = useState(sitePermissionsRoute)
  const [sitePermissionsOpen, setSitePermissionsOpen] = useState(initialRoute.open)
  const [appInfo, setAppInfo] = useState<AppVersionInfo | null>(null)
  const [isDefaultBrowser, setIsDefaultBrowser] = useState<boolean | null>(null)
  const [profiles, setProfiles] = useState<ProfilesState>({
    profiles: [],
    activeProfileId: DEFAULT_PROFILE_ID
  })
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfilePicture, setNewProfilePicture] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingPicture, setEditingPicture] = useState<string | null>(null)
  const [autofill, setAutofill] = useState<AutofillState>({
    addresses: [],
    contacts: [],
    paymentMethods: [],
    formHistory: []
  })
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [addressDraft, setAddressDraft] = useState<Partial<AutofillAddress>>({})
  const [showContactForm, setShowContactForm] = useState(false)
  const [contactDraft, setContactDraft] = useState<Partial<AutofillContact>>({})
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentDraft, setPaymentDraft] = useState<Partial<AutofillPaymentMethod>>({})
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [extensionError, setExtensionError] = useState<string | null>(null)
  const [installingExtension, setInstallingExtension] = useState(false)
  const [checkingExtensionUpdates, setCheckingExtensionUpdates] = useState(false)
  const [extensionUpdateMessage, setExtensionUpdateMessage] = useState<string | null>(null)
  const [storeUrl, setStoreUrl] = useState('')
  const [nativeHosts, setNativeHosts] = useState<NativeMessagingHost[]>([])
  const [nativeHostName, setNativeHostName] = useState('')
  const [nativeHostPath, setNativeHostPath] = useState('')
  const [nativeHostOrigins, setNativeHostOrigins] = useState('')

  useEffect(() => {
    const bookmarks = useBookmarksStore.getState()
    const history = useHistoryStore.getState()
    const downloads = useDownloadsStore.getState()

    void window.voyager.bookmarks.getState().then(useBookmarksStore.getState().applyState)
    void window.voyager.history.getState().then(useHistoryStore.getState().applyState)
    void window.voyager.downloads.getState().then(useDownloadsStore.getState().applyState)
    void window.voyager.settings.get().then((prefs) => {
      setPreferences(prefs)
      useBrowserStore.getState().setSearchEngine(prefs.searchEngine ?? DEFAULT_SEARCH_ENGINE)
    })
    void window.voyager.appInfo().then(setAppInfo)
    void window.voyager.defaultBrowser.isDefault().then(setIsDefaultBrowser)
    void window.voyager.profiles.getState().then(setProfiles)
    void window.voyager.autofill.getState().then(setAutofill)
    void window.voyager.extensions.getState().then(setExtensions)
    void window.voyager.extensions.getNativeHosts().then(setNativeHosts)

    const unsubscribes = [
      window.voyager.profiles.onStateChanged(setProfiles),
      window.voyager.bookmarks.onStateChanged(bookmarks.applyState),
      window.voyager.bookmarks.onClipboardChanged(bookmarks.applyClipboard),
      window.voyager.history.onStateChanged(history.applyState),
      window.voyager.downloads.onStateChanged(downloads.applyState),
      window.voyager.autofill.onStateChanged(setAutofill),
      window.voyager.extensions.onStateChanged(setExtensions)
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [])

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.voyager.contentBlocking
        .getStats()
        .then((next) => {
          if (active) setBlockingStats(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!profilesRoute()) return
    const id = window.setTimeout(() => scrollToSection('profiles'), 0)
    return () => window.clearTimeout(id)
  }, [])

  const setPreference = async (
    key: keyof UserPreferences,
    value: boolean | string | string[] | number
  ): Promise<void> => {
    setPreferences((current) => ({ ...current, [key]: value }))
    const prefs = await window.voyager.settings.set(key, value)
    setPreferences(prefs)
  }

  const loadUnpackedExtension = async (): Promise<void> => {
    setInstallingExtension(true)
    setExtensionError(null)
    try {
      const path = await window.voyager.extensions.chooseDirectory()
      if (!path) return
      setExtensions(await window.voyager.extensions.install(path))
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Could not load extension.')
    } finally {
      setInstallingExtension(false)
    }
  }

  const installCrxExtension = async (): Promise<void> => {
    setInstallingExtension(true)
    setExtensionError(null)
    try {
      const path = await window.voyager.extensions.chooseCrx()
      if (!path) return
      setExtensions(await window.voyager.extensions.install(path))
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Could not install CRX extension.')
    } finally {
      setInstallingExtension(false)
    }
  }

  const installStoreExtension = async (): Promise<void> => {
    setInstallingExtension(true)
    setExtensionError(null)
    try {
      setExtensions(await window.voyager.extensions.installFromStore(storeUrl))
      setStoreUrl('')
    } catch (error) {
      setExtensionError(
        error instanceof Error ? error.message : 'Could not install from the Web Store.'
      )
    } finally {
      setInstallingExtension(false)
    }
  }

  const removeExtension = async (path: string): Promise<void> => {
    setExtensionError(null)
    try {
      setExtensions(await window.voyager.extensions.uninstall(path))
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Could not remove extension.')
    }
  }

  const checkExtensionUpdates = async (): Promise<void> => {
    setCheckingExtensionUpdates(true)
    setExtensionError(null)
    setExtensionUpdateMessage(null)
    try {
      const results = await window.voyager.extensions.checkUpdates()
      const updated = results.filter((result) => result.status === 'updated').length
      const failed = results.filter((result) => result.status === 'failed').length
      setExtensions(await window.voyager.extensions.getState())
      setExtensionUpdateMessage(
        updated > 0
          ? `Updated ${updated} extension${updated === 1 ? '' : 's'}.`
          : failed > 0
            ? `Update check finished with ${failed} error${failed === 1 ? '' : 's'}.`
            : 'Extensions are up to date.'
      )
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Could not check for updates.')
    } finally {
      setCheckingExtensionUpdates(false)
    }
  }

  const addNativeHost = async (): Promise<void> => {
    const name = nativeHostName.trim()
    const path = nativeHostPath.trim()
    const allowedOrigins = nativeHostOrigins
      .split(/[\s,]+/)
      .map((origin) => origin.trim())
      .filter(Boolean)
    if (!name || !path || allowedOrigins.length === 0) {
      setExtensionError('Enter a host name, executable path, and at least one allowed origin.')
      return
    }
    setExtensionError(null)
    try {
      const next = [
        ...nativeHosts.filter((host) => host.name !== name),
        { name, path, allowedOrigins }
      ]
      setNativeHosts(await window.voyager.extensions.setNativeHosts(next))
      setNativeHostName('')
      setNativeHostPath('')
      setNativeHostOrigins('')
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Could not save the native host.')
    }
  }

  const removeNativeHost = async (name: string): Promise<void> => {
    setExtensionError(null)
    try {
      setNativeHosts(
        await window.voyager.extensions.setNativeHosts(
          nativeHosts.filter((host) => host.name !== name)
        )
      )
    } catch (error) {
      setExtensionError(
        error instanceof Error ? error.message : 'Could not remove the native host.'
      )
    }
  }

  const topHosts = blockingStats?.topHosts ?? []
  const maxHostCount = topHosts[0]?.count ?? 1

  const clearSelected = async () => {
    setClearing(true)
    try {
      if (preferences.clearHistory) await window.voyager.history.clear()
      if (preferences.clearDownloads) await window.voyager.downloads.clear()
      if (preferences.clearBookmarks) await window.voyager.bookmarks.clear()
      await window.voyager.browsingData.clear({
        cookies: preferences.clearCookies,
        localStorage: preferences.clearLocalStorage,
        indexedDb: preferences.clearIndexedDb,
        cache: preferences.clearCache,
        sitePermissions: preferences.clearSitePermissions
      })
      void window.voyager.history.getState().then(useHistoryStore.getState().applyState)
      void window.voyager.downloads.getState().then(useDownloadsStore.getState().applyState)
      void window.voyager.bookmarks.getState().then(useBookmarksStore.getState().applyState)
      void window.voyager.autofill.getState().then(setAutofill)
    } finally {
      setClearing(false)
    }
  }

  const saveNewAddress = async (): Promise<void> => {
    if (
      !addressDraft.name ||
      !addressDraft.streetAddress ||
      !addressDraft.city ||
      !addressDraft.postalCode ||
      !addressDraft.country
    )
      return
    setAutofill(
      await window.voyager.autofill.saveAddress({
        label: addressDraft.label || '',
        name: addressDraft.name,
        organization: addressDraft.organization || '',
        streetAddress: addressDraft.streetAddress,
        streetAddress2: addressDraft.streetAddress2 || '',
        city: addressDraft.city,
        region: addressDraft.region || '',
        postalCode: addressDraft.postalCode,
        country: addressDraft.country,
        phone: addressDraft.phone || '',
        email: addressDraft.email || ''
      })
    )
    setAddressDraft({})
    setShowAddressForm(false)
  }

  const saveNewContact = async (): Promise<void> => {
    if (!contactDraft.name) return
    setAutofill(
      await window.voyager.autofill.saveContact({
        name: contactDraft.name,
        email: contactDraft.email || '',
        phone: contactDraft.phone || '',
        organization: contactDraft.organization || ''
      })
    )
    setContactDraft({})
    setShowContactForm(false)
  }

  const saveNewPayment = async (): Promise<void> => {
    if (
      !paymentDraft.nameOnCard ||
      !paymentDraft.cardNumber ||
      !paymentDraft.expiryMonth ||
      !paymentDraft.expiryYear
    )
      return
    setAutofill(
      await window.voyager.autofill.savePayment({
        nameOnCard: paymentDraft.nameOnCard,
        cardNumber: paymentDraft.cardNumber,
        expiryMonth: paymentDraft.expiryMonth,
        expiryYear: paymentDraft.expiryYear,
        cardType: paymentDraft.cardType || ''
      })
    )
    setPaymentDraft({})
    setShowPaymentForm(false)
  }

  const contentRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState(profilesRoute() ? 'profiles' : 'appearance')

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    if (id === 'site-permissions') {
      setSitePermissionsOpen(true)
      return
    }
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`)
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
  }

  // Keep the sidebar highlight in sync while the content pane scrolls.
  useEffect(() => {
    const container = contentRef.current
    if (!container || sitePermissionsOpen) return
    const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-settings-section]'))
    if (sections.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const id = visible[0]?.target.getAttribute('data-settings-section')
        if (id) setActiveSection(id)
      },
      { root: container, rootMargin: '0px 0px -65% 0px', threshold: 0 }
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [sitePermissionsOpen])

  const readProfilePicture = async (file: File): Promise<string | null> => {
    if (!file.type.startsWith('image/')) {
      setProfileError('Choose an image file.')
      return null
    }

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
      reader.readAsDataURL(file)
    })
  }

  const createProfile = async (): Promise<void> => {
    const name = newProfileName.trim()
    if (!name) {
      setProfileError('Enter a profile name.')
      return
    }
    setProfileError(null)
    try {
      const profile = await window.voyager.profiles.create({
        name,
        picture: newProfilePicture
      })
      setProfiles((current) => ({ ...current, profiles: [...current.profiles, profile] }))
      setNewProfileName('')
      setNewProfilePicture(null)
      setProfileError(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not create profile.')
    }
  }

  const startEditingProfile = (profile: ProfileInfo): void => {
    setEditingProfileId(profile.id)
    setEditingName(profile.name)
    setEditingPicture(profile.picture ?? null)
    setProfileError(null)
  }

  const saveProfile = async (): Promise<void> => {
    if (!editingProfileId) return
    try {
      const profile = await window.voyager.profiles.update({
        id: editingProfileId,
        name: editingName,
        picture: editingPicture
      })
      setProfiles((current) => ({
        ...current,
        profiles: current.profiles.map((candidate) =>
          candidate.id === profile.id ? profile : candidate
        )
      }))
      setEditingProfileId(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not update profile.')
    }
  }

  const deleteProfile = async (id: string): Promise<void> => {
    if (id === DEFAULT_PROFILE_ID) return
    if (
      !window.confirm(
        'Delete this profile? Its bookmarks, history, and browsing data will be removed.'
      )
    )
      return
    try {
      const state = await window.voyager.profiles.delete(id)
      setProfiles(state)
      if (editingProfileId === id) setEditingProfileId(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not delete profile.')
    }
  }

  if (sitePermissionsOpen) {
    return (
      <SitePermissionsSettings
        initialOrigin={initialRoute.origin}
        onBack={() => {
          setSitePermissionsOpen(false)
          setActiveSection('privacy')
          window.history.replaceState(null, '', window.location.href.split('#')[0])
        }}
      />
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-4 pb-3 pt-5">
          <h1 className="text-[17px] font-semibold text-fg">Settings</h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Voyager {appInfo?.app ?? '1.0.0'}
            {appInfo?.dev ? ' (Dev)' : ''}
          </p>
        </div>
        <nav aria-label="Settings sections" className="flex-1 overflow-y-auto px-2 pb-4">
          {SETTINGS_NAV_GROUPS.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className={groupIndex > 0 ? 'mt-3 border-t border-border pt-3' : ''}
            >
              {group.map((item) => {
                if (item.id === 'extensions' && !preferences.developerMode) return null
                const Icon = item.icon
                const active = activeSection === item.id
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                        active
                          ? 'bg-accent/10 font-medium text-fg'
                          : 'text-muted hover:bg-hover hover:text-fg'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                    </button>
                    {item.children && (
                      <div className="mb-1 ml-[1.375rem] space-y-0.5 border-l border-border pl-3">
                        {item.children.map((child) => {
                          const childActive = activeSection === child.id
                          return (
                            <button
                              key={child.id}
                              type="button"
                              aria-label={
                                child.id === 'site-permissions'
                                  ? 'Open site permission settings'
                                  : child.label
                              }
                              onClick={() => scrollToSection(child.id)}
                              aria-current={childActive ? 'page' : undefined}
                              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                                childActive
                                  ? 'bg-accent/10 font-medium text-fg'
                                  : 'text-muted hover:bg-hover hover:text-fg'
                              }`}
                            >
                              {child.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-8">
            <section
              data-settings-section="profiles"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-1 text-[15px] font-semibold text-fg">Profiles</h2>
              <p className="mb-4 text-[12px] text-muted">
                Each profile has its own bookmarks, history, downloads, site permissions, and
                settings.
              </p>

              {profileError && (
                <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                  {profileError}
                </div>
              )}

              <div className="space-y-2">
                {profiles.profiles.map((profile) => {
                  const active = profile.id === profiles.activeProfileId
                  const editing = editingProfileId === profile.id
                  return (
                    <div
                      key={profile.id}
                      className={`rounded-md border px-3 py-2.5 ${
                        active ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg'
                      }`}
                    >
                      {editing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-fg"
                            aria-label="Profile name"
                          />
                          <div className="flex items-center gap-2">
                            {editingPicture ? (
                              <img
                                src={editingPicture}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <span className="text-[12px] text-muted">No picture</span>
                            )}
                            <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-hover">
                              Choose picture
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0]
                                  event.target.value = ''
                                  if (!file) return
                                  try {
                                    const pic = await readProfilePicture(file)
                                    if (pic) setEditingPicture(pic)
                                  } catch {
                                    setProfileError('Could not read that image.')
                                  }
                                }}
                              />
                            </label>
                            {editingPicture && (
                              <button
                                type="button"
                                onClick={() => setEditingPicture(null)}
                                className="text-[12px] text-muted hover:text-danger"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void saveProfile()}
                              className="rounded-md bg-accent px-2.5 py-1 text-[12px] text-accent-foreground"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingProfileId(null)}
                              className="rounded-md border border-border px-2.5 py-1 text-[12px] text-fg"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          {profile.picture ? (
                            <img
                              src={profile.picture}
                              alt=""
                              className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border"
                            />
                          ) : (
                            <span
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-[13px] font-semibold text-fg ring-1 ring-border"
                              aria-hidden="true"
                            >
                              {(profile.name.trim()[0] ?? '?').toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-fg">
                                {profile.name}
                              </span>
                              {active && (
                                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  This window
                                </span>
                              )}
                              {profile.isDefault && (
                                <span className="text-[10px] text-muted">Default</span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              title="Open profile in a new window"
                              aria-label={`Open ${profile.name} in a new window`}
                              onClick={() => void window.voyager.profiles.openWindow(profile.id)}
                              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Edit profile"
                              aria-label={`Edit ${profile.name}`}
                              onClick={() => startEditingProfile(profile)}
                              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {!profile.isDefault && (
                              <button
                                type="button"
                                title="Delete profile"
                                aria-label={`Delete ${profile.name}`}
                                onClick={() => void deleteProfile(profile.id)}
                                className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 text-[13px] font-medium text-fg">Add profile</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[180px] flex-1">
                    <span className="sr-only">Profile name</span>
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(event) => setNewProfileName(event.target.value)}
                      placeholder="Profile name"
                      className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-fg"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void createProfile()
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void createProfile()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {newProfilePicture ? (
                    <img
                      src={newProfilePicture}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : null}
                  <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-hover">
                    {newProfilePicture ? 'Change picture' : 'Add picture'}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (!file) return
                        try {
                          const pic = await readProfilePicture(file)
                          if (pic) setNewProfilePicture(pic)
                        } catch {
                          setProfileError('Could not read that image.')
                        }
                      }}
                    />
                  </label>
                  {newProfilePicture && (
                    <button
                      type="button"
                      onClick={() => setNewProfilePicture(null)}
                      className="text-[12px] text-muted hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section
              data-settings-section="appearance"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Appearance</h2>
              <div className="space-y-2">
                {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-[13px] text-fg">
                    <input
                      type="radio"
                      name="theme"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    <span className="capitalize">{m}</span>
                  </label>
                ))}
              </div>
              <ThemeSettings />
              <div className="mt-4 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.verticalTabs}
                    onChange={(event) => setPreference('verticalTabs', event.target.checked)}
                  />
                  <span>Use vertical tabs (compact favicon rail that expands on hover)</span>
                </label>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.showHomeButton}
                    onChange={(event) => setPreference('showHomeButton', event.target.checked)}
                  />
                  <span>Show Home button</span>
                </label>
                {preferences.showHomeButton && (
                  <label className="mt-3 block">
                    <span className="mb-1 block text-[12px] text-muted">Home page</span>
                    <input
                      type="text"
                      className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                      value={preferences.homeUrl}
                      placeholder={DEFAULT_NEW_TAB_URL}
                      onChange={(e) => void setPreference('homeUrl', e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
                <div>
                  <div className="text-[13px] text-fg">Default browser</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {isDefaultBrowser === null
                      ? 'Checking…'
                      : isDefaultBrowser
                        ? 'Voyager opens web links by default.'
                        : 'Voyager is not your default browser yet.'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isDefaultBrowser === true}
                  onClick={() => {
                    void window.voyager.defaultBrowser.setDefault().then(setIsDefaultBrowser)
                  }}
                  className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground disabled:opacity-50"
                >
                  {isDefaultBrowser === true ? 'Default' : 'Set as default'}
                </button>
              </div>
            </section>

            <section
              data-settings-section="startup"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">On startup</h2>
              <label className="flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  checked={preferences.restoreSession}
                  onChange={(event) => setPreference('restoreSession', event.target.checked)}
                />
                <span>Continue where you left off (reopen tabs from the previous session)</span>
              </label>
            </section>

            <section
              data-settings-section="search"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Search</h2>
              <select
                className="rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-fg"
                value={searchEngine}
                onChange={(e) => {
                  const engine = e.target.value as SearchEngineId
                  setSearchEngine(engine)
                  void window.voyager.settings.set('searchEngine', engine)
                }}
              >
                {Object.entries(SEARCH_ENGINES).map(([id, engine]) => (
                  <option key={id} value={id}>
                    {engine.name}
                  </option>
                ))}
              </select>
            </section>

            <section
              data-settings-section="content-blocking"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Content blocking</h2>
              <label className="mb-2 flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  checked={preferences.contentBlocking}
                  onChange={(event) => setPreference('contentBlocking', event.target.checked)}
                />
                <span>Block ads and trackers</span>
              </label>
              <p className="text-[11.5px] text-muted">
                Blocks requests to known advertising and tracking domains using the built-in list
                plus any remote lists you enable below. Off by default.
              </p>

              <div className="mt-3 space-y-2">
                <p className="text-[12px] font-medium text-fg">Filter lists</p>
                <label className="flex items-start gap-2 text-[12.5px] text-fg">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={preferences.builtinFilterList}
                    onChange={(event) =>
                      void setPreference('builtinFilterList', event.target.checked)
                    }
                  />
                  <span>
                    <span className="block">Voyager built-in list</span>
                    <span className="block text-[11.5px] text-muted">
                      {BUILTIN_BLOCKED_DOMAINS.length} bundled domains
                    </span>
                  </span>
                </label>
                {FILTER_LISTS.map((list) => (
                  <label key={list.id} className="flex items-start gap-2 text-[12.5px] text-fg">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={preferences.filterLists.includes(list.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...preferences.filterLists, list.id]
                          : preferences.filterLists.filter((id) => id !== list.id)
                        void setPreference('filterLists', next)
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block">{list.name}</span>
                      <span className="block text-[11.5px] text-muted">{list.description}</span>
                    </span>
                  </label>
                ))}

                <div className="border-t border-border pt-3">
                  <p className="text-[12px] font-medium text-fg">Custom filter lists</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    Add a hosts-format list from an http/https URL or upload a local hosts file.
                  </p>

                  <div className="mt-2 flex gap-2">
                    <input
                      type="url"
                      value={customFilterUrl}
                      onChange={(event) => {
                        setCustomFilterUrl(event.target.value)
                        if (customFilterError) setCustomFilterError(null)
                      }}
                      placeholder="https://example.com/hosts.txt"
                      aria-label="Custom hosts list URL"
                      className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-muted"
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        const url = customFilterUrl.trim()
                        if (!/^https?:\/\//i.test(url)) {
                          setCustomFilterError('Enter a valid http or https URL.')
                          return
                        }
                        if (preferences.customFilterLists.includes(url)) {
                          setCustomFilterError('That list has already been added.')
                          return
                        }
                        void setPreference('customFilterLists', [
                          ...preferences.customFilterLists,
                          url
                        ])
                        setCustomFilterUrl('')
                        setCustomFilterError(null)
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Add custom filter list"
                      className="shrink-0 rounded-md border border-border bg-bg px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover"
                      onClick={() => {
                        const url = customFilterUrl.trim()
                        if (!/^https?:\/\//i.test(url)) {
                          setCustomFilterError('Enter a valid http or https URL.')
                          return
                        }
                        if (preferences.customFilterLists.includes(url)) {
                          setCustomFilterError('That list has already been added.')
                          return
                        }
                        void setPreference('customFilterLists', [
                          ...preferences.customFilterLists,
                          url
                        ])
                        setCustomFilterUrl('')
                        setCustomFilterError(null)
                      }}
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-2">
                    <label
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover ${
                        importingFilterFile ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{importingFilterFile ? 'Uploading…' : 'Upload hosts file'}</span>
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="sr-only"
                        disabled={importingFilterFile}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (!file) return
                          setCustomFilterError(null)
                          setImportingFilterFile(true)
                          void file
                            .text()
                            .then(async (content) => {
                              const prefs = await window.voyager.settings.importFilterFile(
                                file.name,
                                content
                              )
                              setPreferences(prefs)
                            })
                            .catch((error: unknown) => {
                              setCustomFilterError(
                                error instanceof Error
                                  ? error.message
                                  : 'Could not import that hosts file.'
                              )
                            })
                            .finally(() => setImportingFilterFile(false))
                        }}
                      />
                    </label>
                  </div>

                  {customFilterError && (
                    <p className="mt-1.5 text-[11.5px] text-danger">{customFilterError}</p>
                  )}

                  {(preferences.customFilterLists.length > 0 ||
                    preferences.customFilterFiles.length > 0) && (
                    <ul className="mt-2 space-y-1.5">
                      {preferences.customFilterLists.map((url) => (
                        <li
                          key={url}
                          className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11.5px] text-fg" title={url}>
                              {url}
                            </span>
                            {preferences.customFilterListErrors[url] && (
                              <span className="block text-[11px] text-danger">
                                {preferences.customFilterListErrors[url]}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
                            aria-label={`Remove custom filter list ${url}`}
                            onClick={() =>
                              void setPreference(
                                'customFilterLists',
                                preferences.customFilterLists.filter((entry) => entry !== url)
                              )
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                      {preferences.customFilterFiles.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
                        >
                          <span
                            className="min-w-0 flex-1 truncate text-[11.5px] text-fg"
                            title={file.name}
                          >
                            {file.name}
                            <span className="ml-1.5 text-muted">(uploaded file)</span>
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
                            aria-label={`Remove uploaded filter list ${file.name}`}
                            onClick={async () => {
                              try {
                                const prefs = await window.voyager.settings.removeFilterFile(
                                  file.id
                                )
                                setPreferences(prefs)
                              } catch (error: unknown) {
                                setCustomFilterError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not remove that hosts file.'
                                )
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="text-[11.5px] text-muted">
                  Enabled lists are downloaded when content blocking is on and refreshed every 7
                  days. Until a list finishes downloading, the built-in and cached domains are used.
                </p>
              </div>
            </section>

            <section
              data-settings-section="privacy-dashboard"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Privacy dashboard</h2>
              <div className="rounded-md border border-border bg-bg p-4">
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-medium text-fg">Requests blocked this session</p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      Voyager blocks ads and trackers for you to protect your privacy.
                    </p>
                  </div>
                  <span className="text-[26px] font-semibold leading-none tabular-nums text-fg">
                    {blockingStats?.sessionBlocked ?? 0}
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[12px] font-medium text-fg">Top blocked websites</p>
                {topHosts.length > 0 ? (
                  <div className="space-y-3">
                    {topHosts.map((entry) => (
                      <div key={entry.host}>
                        <div className="flex items-center justify-between gap-3 text-[11.5px] text-muted">
                          <span className="min-w-0 truncate">{entry.host}</span>
                          <span className="shrink-0 tabular-nums text-fg">{entry.count}</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{
                              width: `${Math.round((entry.count / maxHostCount) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-muted">
                    No requests blocked yet. Blocked hosts will appear here.
                  </p>
                )}
              </div>
            </section>

            <section
              data-settings-section="privacy"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Privacy and security</h2>
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-between gap-4 rounded-md border border-border bg-bg px-3 py-2.5 text-left transition-colors hover:bg-hover"
                onClick={() => setSitePermissionsOpen(true)}
              >
                <span>
                  <span className="block text-[13px] text-fg">Site permissions</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Manage location, notifications, camera, microphone and more.
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
              </button>

              <label className="mt-4 flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.spellcheck}
                  onChange={(event) => void setPreference('spellcheck', event.target.checked)}
                />
                <span>
                  <span className="block">Use spell check</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Check spelling in text fields on web pages.
                  </span>
                </span>
              </label>

              <label className="mt-4 flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.memorySaver}
                  onChange={(event) => void setPreference('memorySaver', event.target.checked)}
                />
                <span>
                  <span className="block">Memory Saver</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Unload inactive tabs to save memory. They reload when you open them.
                  </span>
                </span>
              </label>

              <label className="mt-4 flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.preloadTopSites}
                  onChange={(event) => void setPreference('preloadTopSites', event.target.checked)}
                />
                <span>
                  <span className="block">Preload top sites</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Prefetch DNS and load frequently visited sites in the background to warm the
                    cache (uses network).
                  </span>
                </span>
              </label>
            </section>

            <section
              data-settings-section="autofill"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-1 text-[15px] font-semibold text-fg">Autofill</h2>
              <p className="mb-4 text-[12px] text-muted">
                Save and fill addresses, contacts, payment methods, and form history for this
                profile.
              </p>

              <label className="flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.autofillProfiles}
                  onChange={(event) => void setPreference('autofillProfiles', event.target.checked)}
                />
                <span>
                  <span className="block">Save and fill addresses and contacts</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Offer saved address and contact information on forms.
                  </span>
                </span>
              </label>

              <label className="mt-3 flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.autofillPayments}
                  onChange={(event) => void setPreference('autofillPayments', event.target.checked)}
                />
                <span>
                  <span className="block">Save and fill payment methods</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Offer saved payment methods on checkout forms.
                  </span>
                </span>
              </label>

              <label className="mt-3 flex items-start gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preferences.saveFormHistory}
                  onChange={(event) => void setPreference('saveFormHistory', event.target.checked)}
                />
                <span>
                  <span className="block">Save form history</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Remember text you enter in forms and offer autocomplete suggestions.
                  </span>
                </span>
              </label>

              <div className="mt-6 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <MapPin className="h-4 w-4" /> Addresses
                  </h3>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-surface-hover"
                    onClick={() => setShowAddressForm((v) => !v)}
                  >
                    {showAddressForm ? 'Cancel' : 'Add address'}
                  </button>
                </div>
                {showAddressForm && (
                  <div className="mb-3 grid gap-2 rounded-md border border-border p-3 text-[12px]">
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Name"
                      value={addressDraft.name ?? ''}
                      onChange={(e) => setAddressDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Street address"
                      value={addressDraft.streetAddress ?? ''}
                      onChange={(e) =>
                        setAddressDraft((d) => ({ ...d, streetAddress: e.target.value }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="City"
                        value={addressDraft.city ?? ''}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, city: e.target.value }))}
                      />
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Region/State"
                        value={addressDraft.region ?? ''}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, region: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Postal code"
                        value={addressDraft.postalCode ?? ''}
                        onChange={(e) =>
                          setAddressDraft((d) => ({ ...d, postalCode: e.target.value }))
                        }
                      />
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Country"
                        value={addressDraft.country ?? ''}
                        onChange={(e) =>
                          setAddressDraft((d) => ({ ...d, country: e.target.value }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Email (optional)"
                        value={addressDraft.email ?? ''}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, email: e.target.value }))}
                      />
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Phone (optional)"
                        value={addressDraft.phone ?? ''}
                        onChange={(e) => setAddressDraft((d) => ({ ...d, phone: e.target.value }))}
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-md bg-accent px-2 py-1.5 text-[12px] text-accent-foreground"
                      onClick={() => void saveNewAddress()}
                    >
                      Save address
                    </button>
                  </div>
                )}
                {autofill.addresses.length === 0 ? (
                  <p className="text-[12px] text-muted">No saved addresses.</p>
                ) : (
                  <ul className="space-y-1">
                    {autofill.addresses.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[12px]"
                      >
                        <span className="truncate text-fg">
                          {a.name} — {a.streetAddress}, {a.city}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-muted hover:text-fg"
                          onClick={() =>
                            void window.voyager.autofill.deleteAddress(a.id).then(setAutofill)
                          }
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <User className="h-4 w-4" /> Contacts
                  </h3>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-surface-hover"
                    onClick={() => setShowContactForm((v) => !v)}
                  >
                    {showContactForm ? 'Cancel' : 'Add contact'}
                  </button>
                </div>
                {showContactForm && (
                  <div className="mb-3 grid gap-2 rounded-md border border-border p-3 text-[12px]">
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Name"
                      value={contactDraft.name ?? ''}
                      onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Email (optional)"
                        value={contactDraft.email ?? ''}
                        onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
                      />
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Phone (optional)"
                        value={contactDraft.phone ?? ''}
                        onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                      />
                    </div>
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Organization (optional)"
                      value={contactDraft.organization ?? ''}
                      onChange={(e) =>
                        setContactDraft((d) => ({ ...d, organization: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="rounded-md bg-accent px-2 py-1.5 text-[12px] text-accent-foreground"
                      onClick={() => void saveNewContact()}
                    >
                      Save contact
                    </button>
                  </div>
                )}
                {autofill.contacts.length === 0 ? (
                  <p className="text-[12px] text-muted">No saved contacts.</p>
                ) : (
                  <ul className="space-y-1">
                    {autofill.contacts.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[12px]"
                      >
                        <span className="truncate text-fg">
                          {c.name}
                          {c.email ? ` — ${c.email}` : ''}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-muted hover:text-fg"
                          onClick={() =>
                            void window.voyager.autofill.deleteContact(c.id).then(setAutofill)
                          }
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <CreditCard className="h-4 w-4" /> Payment methods
                  </h3>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-surface-hover"
                    onClick={() => setShowPaymentForm((v) => !v)}
                  >
                    {showPaymentForm ? 'Cancel' : 'Add payment method'}
                  </button>
                </div>
                {showPaymentForm && (
                  <div className="mb-3 grid gap-2 rounded-md border border-border p-3 text-[12px]">
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Name on card"
                      value={paymentDraft.nameOnCard ?? ''}
                      onChange={(e) =>
                        setPaymentDraft((d) => ({ ...d, nameOnCard: e.target.value }))
                      }
                    />
                    <input
                      className="rounded border border-border bg-base px-2 py-1"
                      placeholder="Card number"
                      value={paymentDraft.cardNumber ?? ''}
                      onChange={(e) =>
                        setPaymentDraft((d) => ({ ...d, cardNumber: e.target.value }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Expiry month (MM)"
                        value={paymentDraft.expiryMonth ?? ''}
                        onChange={(e) =>
                          setPaymentDraft((d) => ({ ...d, expiryMonth: e.target.value }))
                        }
                      />
                      <input
                        className="rounded border border-border bg-base px-2 py-1"
                        placeholder="Expiry year (YYYY)"
                        value={paymentDraft.expiryYear ?? ''}
                        onChange={(e) =>
                          setPaymentDraft((d) => ({ ...d, expiryYear: e.target.value }))
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-md bg-accent px-2 py-1.5 text-[12px] text-accent-foreground"
                      onClick={() => void saveNewPayment()}
                    >
                      Save payment method
                    </button>
                  </div>
                )}
                {autofill.paymentMethods.length === 0 ? (
                  <p className="text-[12px] text-muted">No saved payment methods.</p>
                ) : (
                  <ul className="space-y-1">
                    {autofill.paymentMethods.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[12px]"
                      >
                        <span className="truncate text-fg">
                          {p.nameOnCard} — ••••{' '}
                          {p.cardNumber.replace(/\s+/g, '').slice(-4) || '••••'}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-muted hover:text-fg"
                          onClick={() =>
                            void window.voyager.autofill.deletePayment(p.id).then(setAutofill)
                          }
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <FileText className="h-4 w-4" /> Form history
                  </h3>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-surface-hover disabled:opacity-50"
                    disabled={autofill.formHistory.length === 0}
                    onClick={() =>
                      void window.voyager.autofill.clearFormHistory().then(setAutofill)
                    }
                  >
                    Clear form history
                  </button>
                </div>
                {autofill.formHistory.length === 0 ? (
                  <p className="text-[12px] text-muted">No saved form history.</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-auto">
                    {autofill.formHistory.slice(0, 50).map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[12px]"
                      >
                        <span className="truncate text-fg" title={`${e.field}: ${e.value}`}>
                          {e.field}: {e.value}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-muted hover:text-fg"
                          onClick={() =>
                            void window.voyager.autofill
                              .deleteFormHistoryEntry(e.id)
                              .then(setAutofill)
                          }
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section
              data-settings-section="proxy"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-1 text-[15px] font-semibold text-fg">Proxy</h2>
              <p className="mb-4 text-[12px] text-muted">
                Configure how this profile connects to the network. Supports HTTP, HTTPS, SOCKS4,
                and SOCKS5 proxies.
              </p>

              <div className="space-y-2">
                {(
                  [
                    { id: 'system', label: 'Use system proxy settings' },
                    { id: 'direct', label: 'No proxy (direct connection)' },
                    { id: 'fixed_servers', label: 'Manual proxy configuration' }
                  ] as { id: ProxyMode; label: string }[]
                ).map((option) => (
                  <label key={option.id} className="flex items-center gap-2 text-[13px] text-fg">
                    <input
                      type="radio"
                      name="proxyMode"
                      checked={preferences.proxyMode === option.id}
                      onChange={() => void setPreference('proxyMode', option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              {preferences.proxyMode === 'fixed_servers' && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[12px] text-muted">Type</span>
                      <select
                        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                        value={preferences.proxyScheme}
                        onChange={(e) =>
                          void setPreference('proxyScheme', e.target.value as ProxyScheme)
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks4">SOCKS4</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[12px] text-muted">Host</span>
                      <input
                        type="text"
                        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                        value={preferences.proxyHost}
                        placeholder="proxy.example.com"
                        onChange={(e) => void setPreference('proxyHost', e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[12px] text-muted">Port</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                        value={preferences.proxyPort}
                        onChange={(e) => {
                          const n = Number.parseInt(e.target.value, 10)
                          if (Number.isFinite(n)) void setPreference('proxyPort', n)
                        }}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[12px] text-muted">Bypass rules</span>
                      <input
                        type="text"
                        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                        value={preferences.proxyBypassRules}
                        placeholder="<local>"
                        onChange={(e) => void setPreference('proxyBypassRules', e.target.value)}
                      />
                      <span className="mt-1 block text-[11px] text-muted">
                        Comma-separated rules (e.g. <code>&lt;local&gt;</code>,{' '}
                        <code>*.example.com</code>).
                      </span>
                    </label>
                  </div>
                  {!preferences.proxyHost.trim() && (
                    <p className="text-[12px] text-muted">
                      Enter a host to enable the manual proxy. System proxy settings are used until
                      a host is provided.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section
              data-settings-section="downloads"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Downloads</h2>
              <label className="flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  checked={preferences.openDownloadsWhenDone}
                  onChange={(event) => setPreference('openDownloadsWhenDone', event.target.checked)}
                />
                <span>Open files automatically when downloads finish</span>
              </label>
            </section>

            <section
              data-settings-section="clear-browsing-data"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Clear browsing data</h2>
              <p className="mb-4 text-[13px] text-fg">
                Choose what Voyager includes when clearing data.
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearHistory}
                    onChange={(event) => setPreference('clearHistory', event.target.checked)}
                  />
                  <span>Browsing history</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearDownloads}
                    onChange={(event) => setPreference('clearDownloads', event.target.checked)}
                  />
                  <span>Download history</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearBookmarks}
                    onChange={(event) => setPreference('clearBookmarks', event.target.checked)}
                  />
                  <span>Bookmarks</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearCookies}
                    onChange={(event) => setPreference('clearCookies', event.target.checked)}
                  />
                  <span>Cookies</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearLocalStorage}
                    onChange={(event) => setPreference('clearLocalStorage', event.target.checked)}
                  />
                  <span>Local storage</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearIndexedDb}
                    onChange={(event) => setPreference('clearIndexedDb', event.target.checked)}
                  />
                  <span>IndexedDB</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearCache}
                    onChange={(event) => setPreference('clearCache', event.target.checked)}
                  />
                  <span>Cached images and files</span>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    checked={preferences.clearSitePermissions}
                    onChange={(event) =>
                      setPreference('clearSitePermissions', event.target.checked)
                    }
                  />
                  <span>Site permissions</span>
                </label>
              </div>
              <button
                type="button"
                className="mt-4 rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground disabled:opacity-50"
                disabled={
                  clearing ||
                  !(
                    preferences.clearHistory ||
                    preferences.clearDownloads ||
                    preferences.clearBookmarks ||
                    preferences.clearCookies ||
                    preferences.clearLocalStorage ||
                    preferences.clearIndexedDb ||
                    preferences.clearCache ||
                    preferences.clearSitePermissions
                  )
                }
                onClick={clearSelected}
              >
                {clearing ? 'Clearing...' : 'Clear selected data'}
              </button>
            </section>

            <section
              data-settings-section="data"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Data</h2>
              <div className="space-y-2 text-[13px] text-fg">
                <div>Bookmarks: {bookmarks.length}</div>
                <div>History entries: {history.length}</div>
                <div>Downloads: {downloads.length}</div>
                <div>Saved addresses: {autofill.addresses.length}</div>
                <div>Saved contacts: {autofill.contacts.length}</div>
                <div>Saved payment methods: {autofill.paymentMethods.length}</div>
                <div>Form history entries: {autofill.formHistory.length}</div>
              </div>
            </section>

            <section
              data-settings-section="developer"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-1 text-[15px] font-semibold text-fg">Developer</h2>
              <p className="mb-4 text-[12px] text-muted">
                Developer features are also available from the View menu when Developer Mode is on.
              </p>
              <label className="flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  checked={preferences.developerMode}
                  onChange={(event) => void setPreference('developerMode', event.target.checked)}
                />
                <span>Developer Mode</span>
              </label>
              {preferences.developerMode && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-[12px] text-muted">Custom User-Agent</span>
                  <input
                    type="text"
                    className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-fg"
                    value={preferences.userAgent}
                    placeholder="Leave empty to use the default"
                    onChange={(e) => void setPreference('userAgent', e.target.value)}
                  />
                  <span className="mt-1 block text-[11px] text-muted">
                    You can also choose presets from View → For Developers → User Agent.
                  </span>
                </label>
              )}
            </section>

            {preferences.developerMode && (
              <section
                data-settings-section="extensions"
                className="rounded-lg border border-border bg-surface p-5"
              >
                <h2 className="mb-1 text-[15px] font-semibold text-fg">Extensions</h2>
                <p className="mb-4 text-[12px] text-muted">
                  Install Chrome extensions for this profile from an unpacked folder, a CRX file, or
                  the Chrome Web Store. Password managers such as Bitwarden can then offer and fill
                  saved logins.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadUnpackedExtension()}
                    disabled={installingExtension}
                    className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground disabled:opacity-50"
                  >
                    Load unpacked...
                  </button>
                  <button
                    type="button"
                    onClick={() => void installCrxExtension()}
                    disabled={installingExtension}
                    className="rounded-md border border-border px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:opacity-50"
                  >
                    Install .crx...
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    value={storeUrl}
                    onChange={(event) => setStoreUrl(event.target.value)}
                    placeholder="Chrome Web Store URL or extension id"
                    aria-label="Chrome Web Store URL or extension id"
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-fg placeholder:text-muted"
                  />
                  <button
                    type="button"
                    onClick={() => void installStoreExtension()}
                    disabled={installingExtension || storeUrl.trim() === ''}
                    className="rounded-md border border-border px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:opacity-50"
                  >
                    Install from Web Store
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void checkExtensionUpdates()}
                    disabled={checkingExtensionUpdates}
                    className="rounded-md border border-border px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:opacity-50"
                  >
                    {checkingExtensionUpdates ? 'Checking…' : 'Check for updates'}
                  </button>
                  <span className="text-[11px] text-muted">
                    Downloaded extensions also update automatically at startup and every 6 hours.
                  </span>
                </div>
                {extensionUpdateMessage && (
                  <p className="mt-2 text-[12px] text-muted" role="status">
                    {extensionUpdateMessage}
                  </p>
                )}
                {extensionError && (
                  <p className="mt-2 text-[12px] text-danger" role="alert">
                    {extensionError}
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {extensions.length === 0 ? (
                    <p className="text-[12px] text-muted">No extensions loaded.</p>
                  ) : (
                    extensions.map((extension) => (
                      <div
                        key={extension.path}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[13px] text-fg">
                            {extension.name}
                            <span className="ml-2 text-[11px] text-muted">
                              v{extension.version}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-muted">
                            {extension.loaded
                              ? extension.path
                              : `Could not be loaded from ${extension.path}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeExtension(extension.path)}
                          className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-hover"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-5 border-t border-border pt-4">
                  <h3 className="mb-1 text-[13px] font-semibold text-fg">Native messaging hosts</h3>
                  <p className="mb-3 text-[12px] text-muted">
                    Register executables that extensions may exchange JSON messages with. Each host
                    needs an absolute path and the extension origins allowed to contact it.
                  </p>
                  <div className="grid gap-2">
                    <input
                      value={nativeHostName}
                      onChange={(event) => setNativeHostName(event.target.value)}
                      placeholder="Host name, e.g. com.example.password_manager"
                      aria-label="Native messaging host name"
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-fg placeholder:text-muted"
                    />
                    <input
                      value={nativeHostPath}
                      onChange={(event) => setNativeHostPath(event.target.value)}
                      placeholder="Absolute path to the executable"
                      aria-label="Native messaging host executable path"
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-fg placeholder:text-muted"
                    />
                    <input
                      value={nativeHostOrigins}
                      onChange={(event) => setNativeHostOrigins(event.target.value)}
                      placeholder="chrome-extension://abcdefghijklmnop/"
                      aria-label="Allowed extension origins"
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-fg placeholder:text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => void addNativeHost()}
                      className="w-fit rounded-md border border-border px-3 py-1.5 text-[13px] text-fg hover:bg-hover"
                    >
                      Add native host
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {nativeHosts.length === 0 ? (
                      <p className="text-[12px] text-muted">
                        No native messaging hosts registered.
                      </p>
                    ) : (
                      nativeHosts.map((host) => (
                        <div
                          key={host.name}
                          className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-fg">{host.name}</div>
                            <div className="truncate text-[11px] text-muted">{host.path}</div>
                            <div className="truncate text-[11px] text-muted">
                              {host.allowedOrigins.join(', ')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeNativeHost(host.name)}
                            className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] text-fg hover:bg-hover"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <p className="mt-4 text-[11px] text-muted">
                  Extensions run in this profile only and are loaded again on startup. CRX packages
                  are unpacked into Voyager's profile storage. Web Store downloads depend on Google
                  continuing to serve the extension package. Electron does not implement every
                  Chrome extension API. Voyager supplies `chrome.webNavigation`, the full
                  `chrome.tabs` surface, plus `permissions` and native messaging. Emulated APIs are
                  also available through `browser`, including
                  `accessibilityFeatures.animationPolicy` (the only non-ChromeOS accessibility
                  setting), `alarms`, `bookmarks`, `browsingData`, `cookies`, `i18n`, `commands`,
                  `contextMenus`, `storage`, `downloads`, `notifications`, `tts`, `system.cpu`,
                  `system.display`, `system.memory`, `topSites`, `proxy`, `search`, `idle`,
                  `contentSettings`, `history`, `sessions`, and `declarativeNetRequest`. Tab details
                  are limited to sites the extension can access. Cross-window `tabs.move` recreates
                  the tab with a new id, and `tabs.connect` is unavailable because Electron cannot
                  bridge long-lived connections to content scripts. `tabs.sendMessage` and
                  `tabs.executeScript` use Electron's native support where available.
                </p>
              </section>
            )}

            <section
              data-settings-section="about"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">About</h2>
              <div className="space-y-1 text-[13px] text-fg">
                <div>Version {appInfo?.app ?? '1.0.0'}</div>
                <div className="text-[12px] text-muted">
                  {appInfo?.dev ? 'Developer build' : 'Stable build'}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() =>
                    void window.voyager.tabs.create({ url: reportBugUrl(), active: true })
                  }
                  className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground"
                >
                  Report a bug
                </button>
                <span className="text-[11.5px] text-muted">
                  Opens a pre-filled GitHub issue in a new Voyager tab.
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
