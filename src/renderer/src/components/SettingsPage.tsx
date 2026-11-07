import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useHistoryStore } from '../state/historyStore'
import { useDownloadsStore } from '../state/downloadsStore'
import { useTheme } from './providers/theme-context'
import { useBrowserStore } from '../state/browserStore'
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from '../../../shared/search'
import type { AppVersionInfo, ThemeMode, UserPreferences } from '../../../shared/types'
import { BUILTIN_BLOCKED_DOMAINS } from '../../../shared/content-blocking'
import { SitePermissionsSettings } from './SitePermissionsSettings'

function sitePermissionsRoute(): { open: boolean; origin?: string } {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.startsWith('site-permissions')) return { open: false }
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const origin = new URLSearchParams(query).get('origin') ?? undefined
  return { open: true, origin }
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
    contentBlocking: false
  })
  const [clearing, setClearing] = useState(false)
  const [initialRoute] = useState(sitePermissionsRoute)
  const [sitePermissionsOpen, setSitePermissionsOpen] = useState(initialRoute.open)
  const [appInfo, setAppInfo] = useState<AppVersionInfo | null>(null)
  const [isDefaultBrowser, setIsDefaultBrowser] = useState<boolean | null>(null)

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

    const unsubscribes = [
      window.voyager.bookmarks.onStateChanged(bookmarks.applyState),
      window.voyager.history.onStateChanged(history.applyState),
      window.voyager.downloads.onStateChanged(downloads.applyState)
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [])

  useEffect(() => {
    document.title = 'Settings - Voyager'
  }, [])

  const setPreference = async (key: keyof UserPreferences, value: boolean) => {
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
  const [activeSection, setActiveSection] = useState('appearance')

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    if (id === 'site-permissions') {
      setSitePermissionsOpen(true)
      return
    }
    contentRef.current?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
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

  const navItems: Array<{ id: string; label: string; children?: Array<{ id: string; label: string }> }> = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'startup', label: 'On startup' },
    { id: 'search', label: 'Search' },
    { id: 'content-blocking', label: 'Content blocking' },
    {
      id: 'privacy',
      label: 'Privacy and security',
      children: [{ id: 'site-permissions', label: 'Site permissions' }]
    },
    { id: 'downloads', label: 'Downloads' },
    { id: 'clear-browsing-data', label: 'Clear browsing data' },
    { id: 'data', label: 'Data' },
    { id: 'about', label: 'About' }
  ]

  return (
    <div className="flex h-full w-full bg-bg text-fg">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface/40 px-3 py-6">
        <h1 className="mb-1 px-2 text-[18px] font-semibold text-fg">Settings</h1>
        <p className="mb-4 px-2 text-[12px] text-muted">Voyager {appInfo?.app ?? '1.0.0'}</p>
        <nav aria-label="Settings sections" className="space-y-1">
          {navItems.map((item) => (
            <div key={item.id}>
              <button
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                  activeSection === item.id ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                {item.label}
              </button>
              {item.children && (
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border pl-2">
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => scrollToSection(child.id)}
                      className={`flex w-full items-center rounded-md px-2 py-1 text-left text-[12px] transition-colors ${
                        activeSection === child.id
                          ? 'bg-hover text-fg'
                          : 'text-muted hover:bg-hover hover:text-fg'
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-8">
          <section data-settings-section="appearance" className="rounded-lg border border-border bg-surface p-5">
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

          <section data-settings-section="startup" className="rounded-lg border border-border bg-surface p-5">
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

          <section data-settings-section="search" className="rounded-lg border border-border bg-surface p-5">
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

          <section data-settings-section="content-blocking" className="rounded-lg border border-border bg-surface p-5">
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
              Blocks requests to known advertising and tracking domains using built-in and remote
              filter lists. Off by default.
            </p>
            <div className="mt-2 space-y-1 text-[12px] text-muted">
              <div>
                Built-in filter list: {BUILTIN_BLOCKED_DOMAINS.length} domains (bundled fallback)
              </div>
              <div>
                Remote filter list: AdAway hosts from https://adaway.org/hosts.txt (cached on first
                run; refreshed automatically every 7 days)
              </div>
            </div>
          </section>

          <section data-settings-section="privacy" className="rounded-lg border border-border bg-surface p-5">
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

          <section data-settings-section="downloads" className="rounded-lg border border-border bg-surface p-5">
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

          <section data-settings-section="clear-browsing-data" className="rounded-lg border border-border bg-surface p-5">
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
                  onChange={(event) => setPreference('clearSitePermissions', event.target.checked)}
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

          <section data-settings-section="data" className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-4 text-[15px] font-semibold text-fg">Data</h2>
            <div className="space-y-2 text-[13px] text-fg">
              <div>Bookmarks: {bookmarks.length}</div>
              <div>History entries: {history.length}</div>
              <div>Downloads: {downloads.length}</div>
            </div>
          </section>

          <section data-settings-section="about" className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-4 text-[15px] font-semibold text-fg">About</h2>
            <div className="space-y-1 text-[13px] text-fg">
              <div>Voyager {appInfo?.app ?? '1.0.0'}</div>
            </div>
          </section>
        </div>
      </div>
      </div>
    </div>
  )
}
