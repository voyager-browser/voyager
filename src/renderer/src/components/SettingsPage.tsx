import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  Globe,
  Info,
  Palette,
  Pencil,
  Plus,
  Power,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  UserCircle2,
  type LucideIcon
} from 'lucide-react'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useHistoryStore } from '../state/historyStore'
import { useDownloadsStore } from '../state/downloadsStore'
import { useTheme } from './providers/theme-context'
import { useBrowserStore } from '../state/browserStore'
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from '../../../shared/search'
import { DEFAULT_FILTER_LISTS, FILTER_LISTS } from '../../../shared/filter-lists'
import { DEFAULT_PROXY_CONFIG, type ProxyMode, type ProxyScheme } from '../../../shared/proxy'
import type { AppVersionInfo, ThemeMode, UserPreferences } from '../../../shared/types'
import { BUILTIN_BLOCKED_DOMAINS } from '../../../shared/content-blocking'
import {
  DEFAULT_PROFILE_ID,
  PROFILE_COLOR_CLASSES,
  PROFILE_COLORS,
  type ProfileColor,
  type ProfileInfo,
  type ProfilesState
} from '../../../shared/profiles'
import { SitePermissionsSettings } from './SitePermissionsSettings'

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

/** Sidebar groups mirror Chrome's settings navigation. */
const SETTINGS_NAV_GROUPS: SettingsNavItem[][] = [
  [
    { id: 'profiles', label: 'Profiles', icon: UserCircle2 },
    {
      id: 'privacy',
      label: 'Privacy and security',
      icon: ShieldCheck,
      children: [{ id: 'site-permissions', label: 'Site permissions' }]
    },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'startup', label: 'On startup', icon: Power }
  ],
  [
    { id: 'content-blocking', label: 'Content blocking', icon: Shield },
    { id: 'proxy', label: 'Proxy', icon: Globe },
    { id: 'downloads', label: 'Downloads', icon: Download },
    { id: 'clear-browsing-data', label: 'Clear browsing data', icon: Trash2 },
    { id: 'data', label: 'Data', icon: Database }
  ],
  [{ id: 'about', label: 'About', icon: Info }]
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
    customFilterFiles: [],
    proxyMode: DEFAULT_PROXY_CONFIG.mode,
    proxyScheme: DEFAULT_PROXY_CONFIG.scheme,
    proxyHost: DEFAULT_PROXY_CONFIG.host,
    proxyPort: DEFAULT_PROXY_CONFIG.port,
    proxyBypassRules: DEFAULT_PROXY_CONFIG.bypassRules
  })
  const [customFilterUrl, setCustomFilterUrl] = useState('')
  const [customFilterError, setCustomFilterError] = useState<string | null>(null)
  const [importingFilterFile, setImportingFilterFile] = useState(false)
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
  const [newProfileColor, setNewProfileColor] = useState<ProfileColor>('blue')
  const [newProfilePicture, setNewProfilePicture] = useState<string | null>(null)
  const [newProfileBackground, setNewProfileBackground] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState<ProfileColor>('blue')
  const [editingPicture, setEditingPicture] = useState<string | null>(null)
  const [editingBackground, setEditingBackground] = useState('')

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

    const unsubscribes = [
      window.voyager.profiles.onStateChanged(setProfiles),
      window.voyager.bookmarks.onStateChanged(bookmarks.applyState),
      window.voyager.history.onStateChanged(history.applyState),
      window.voyager.downloads.onStateChanged(downloads.applyState)
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [])

  useEffect(() => {
    document.title = 'Settings - Voyager'
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
    } finally {
      setClearing(false)
    }
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
        color: newProfileColor,
        picture: newProfilePicture,
        backgroundColor: newProfileBackground || null
      })
      setProfiles((current) => ({ ...current, profiles: [...current.profiles, profile] }))
      setNewProfileName('')
      setNewProfilePicture(null)
      setNewProfileBackground('')
      setProfileError(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not create profile.')
    }
  }

  const startEditingProfile = (profile: ProfileInfo): void => {
    setEditingProfileId(profile.id)
    setEditingName(profile.name)
    setEditingColor(profile.color)
    setEditingPicture(profile.picture ?? null)
    setEditingBackground(profile.backgroundColor ?? '')
    setProfileError(null)
  }

  const saveProfile = async (): Promise<void> => {
    if (!editingProfileId) return
    try {
      const profile = await window.voyager.profiles.update({
        id: editingProfileId,
        name: editingName,
        color: editingColor,
        picture: editingPicture,
        backgroundColor: editingBackground || null
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
          <p className="mt-0.5 text-[11.5px] text-muted">Voyager {appInfo?.app ?? '1.0.0'}</p>
        </div>
        <nav aria-label="Settings sections" className="flex-1 overflow-y-auto px-2 pb-4">
          {SETTINGS_NAV_GROUPS.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className={groupIndex > 0 ? 'mt-3 border-t border-border pt-3' : ''}
            >
              {group.map((item) => {
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
                          <div className="flex flex-wrap gap-1.5">
                            {PROFILE_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                aria-label={`Color ${color}`}
                                onClick={() => setEditingColor(color)}
                                className={`h-6 w-6 rounded-full ${PROFILE_COLOR_CLASSES[color]} ${
                                  editingColor === color
                                    ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg'
                                    : ''
                                }`}
                              />
                            ))}
                          </div>
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
                          <label className="flex items-center gap-2 text-[12px] text-fg">
                            <span className="text-muted">Background color</span>
                            <input
                              type="color"
                              value={editingBackground || '#0ea5e9'}
                              onChange={(event) => setEditingBackground(event.target.value)}
                              className="h-7 w-9 cursor-pointer rounded border border-border bg-bg p-0.5"
                              aria-label="Custom background color"
                            />
                            {editingBackground && (
                              <button
                                type="button"
                                onClick={() => setEditingBackground('')}
                                className="text-[12px] text-muted hover:text-danger"
                              >
                                Use preset
                              </button>
                            )}
                          </label>
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
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white ${PROFILE_COLOR_CLASSES[profile.color] ?? PROFILE_COLOR_CLASSES.blue}`}
                            aria-hidden="true"
                          >
                            {(profile.name.trim()[0] ?? '?').toUpperCase()}
                          </span>
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PROFILE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`New profile color ${color}`}
                      onClick={() => setNewProfileColor(color)}
                      className={`h-6 w-6 rounded-full ${PROFILE_COLOR_CLASSES[color]} ${
                        newProfileColor === color
                          ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface'
                          : ''
                      }`}
                    />
                  ))}
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
                <label className="mt-2 flex items-center gap-2 text-[12px] text-fg">
                  <span className="text-muted">Background color</span>
                  <input
                    type="color"
                    value={newProfileBackground || '#0ea5e9'}
                    onChange={(event) => setNewProfileBackground(event.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-border bg-bg p-0.5"
                    aria-label="Custom background color"
                  />
                  {newProfileBackground && (
                    <button
                      type="button"
                      onClick={() => setNewProfileBackground('')}
                      className="text-[12px] text-muted hover:text-danger"
                    >
                      Use preset
                    </button>
                  )}
                </label>
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
                          <span
                            className="min-w-0 flex-1 truncate text-[11.5px] text-fg"
                            title={url}
                          >
                            {url}
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
              data-settings-section="privacy"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">Privacy and security</h2>

              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-bg px-3 py-2.5 text-left transition-colors hover:bg-hover"
                onClick={() => {
                  void window.voyager.windows.openIncognito()
                }}
              >
                <span>
                  <span className="block text-[13px] text-fg">Open Incognito Window</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    Browse in a separate in-memory profile that is not saved.
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
              </button>

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
              </div>
            </section>

            <section
              data-settings-section="about"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 className="mb-4 text-[15px] font-semibold text-fg">About</h2>
              <div className="space-y-1 text-[13px] text-fg">
                <div>Version {appInfo?.app ?? '1.0.0'}</div>
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
