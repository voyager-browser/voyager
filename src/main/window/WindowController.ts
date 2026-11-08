import { join } from 'node:path'
import { BaseWindow, WebContentsView, session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IpcChannels } from '../../shared/ipc-channels'
import type { BrowserState } from '../../shared/types'
import { DEFAULT_PROFILE_ID, type ProfileInfo } from '../../shared/profiles'
import { DEFAULT_NEW_TAB_URL, INCOGNITO_PARTITION_PREFIX } from '../../shared/constants'
import { DEFAULT_SEARCH_ENGINE, isSearchEngineId, type SearchEngineId } from '../../shared/search'
import { isNewTab } from '../../shared/url'
import { getSettings, storesFor } from '../store'
import { attachDownloadsTracking } from '../downloads/downloads'
import { attachPermissionHandlers } from '../permissions/permissions'
import { registerVoyagerProtocol } from '../protocol/voyagerProtocol'
import { ensureProfileSession } from '../profiles/session'
import { profileById, profilePartition } from '../profiles/profiles'

import {
  currentBookmarksState,
  addBookmark,
  removeBookmark,
  toggleBookmarksBar
} from '../bookmarks/bookmarks'
import { allWindows } from './windowRegistry'

import { TabManager } from '../tabs/TabManager'
import { createAppMenu } from '../menu/menu'
import {
  DEFAULT_CHROME_HEIGHT,
  TOOLBAR_HEIGHT,
  bookmarksBarExtent,
  computeLayout,
  verticalRailExtent,
  type WindowLayout
} from './ChromeLayout'

/**
 * Owns the single application window: a frameless BaseWindow whose chrome UI
 * (tab strip + toolbar) lives in a fixed-height WebContentsView pinned to the
 * top, with the active tab's WebContentsView filling the space below.
 */
export class WindowController {
  readonly window: BaseWindow
  readonly chrome: WebContentsView
  readonly tabs: TabManager

  private readonly tabViews = new Set<WebContentsView>()
  private activeTabView: WebContentsView | null = null
  private chromeHeight = DEFAULT_CHROME_HEIGHT
  private bookmarksVisible = false
  private verticalTabs = false
  private railExpanded = false
  private overlayOpen = false
  private layout: WindowLayout
  private disposed = false
  private incognito: boolean
  private incognitoPartition: string | null
  private readonly profileId: string

  constructor(options: { incognito?: boolean; profileId?: string } = {}) {
    this.incognito = options.incognito ?? false
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID
    // Incognito profiles live in an in-memory session and are never persisted.
    this.incognitoPartition = this.incognito
      ? `${INCOGNITO_PARTITION_PREFIX}${randomUUID()}`
      : null
    this.verticalTabs = getSettings(this.profileId, 'verticalTabs', false) === true
    if (this.incognito) this.attachIncognitoSession()
    else ensureProfileSession(this.profileId)
    this.layout = computeLayout(1280, 800)

    this.window = new BaseWindow({
      width: 1280,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: 'Voyager',
      backgroundColor: '#1a1b22',
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 8, y: 13 } }
        : { frame: false as const })
    })

    this.chrome = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // Transparent so the page shows through when the chrome expands to host
    // an overlay (dropdown / palette / menu) below the toolbar.
    this.chrome.setBackgroundColor('#00000000')

    this.tabs = new TabManager(this, (state) => {
      this.sendToChrome(IpcChannels.TabsStateChanged, state)
      this.persistSession(state)
    })

    this.window.contentView.addChildView(this.chrome)

    // Re-lay out on every way the window can change shape, including native
    // fullscreen which does not always emit a plain 'resize' on macOS.
    this.window.on('resize', this.handleWindowShapeChange)
    this.window.on('maximize', this.handleWindowShapeChange)
    this.window.on('unmaximize', this.handleWindowShapeChange)
    this.window.on('enter-full-screen', this.handleWindowShapeChange)
    this.window.on('leave-full-screen', this.handleWindowShapeChange)

    this.window.on('closed', () => {
      this.disposed = true
    })
    this.setBookmarksBarVisible(currentBookmarksState(this.profileId).barVisible)
    this.applyLayout()
  }

  /** Whether this window's profile runs in incognito (in-memory session). */
  get isIncognito(): boolean {
    return this.incognito
  }

  /** Profile that owns this window's bookmarks, history, settings, etc. */
  get profile(): string {
    return this.profileId
  }

  /** Metadata for the active profile, used by the toolbar avatar. */
  get profileInfo(): ProfileInfo {
    return (
      profileById(this.profileId) ?? {
        id: DEFAULT_PROFILE_ID,
        name: 'Default',
        color: 'blue',
        createdAt: 0,
        isDefault: true
      }
    )
  }

  /** Session partition for this window; null means the default persistent session. */
  get partition(): string | null {
    return this.incognito ? this.incognitoPartition : profilePartition(this.profileId)
  }

  /** Search engine that applies to new tabs in this window. */
  get searchEngine(): SearchEngineId {
    if (this.incognito) return DEFAULT_SEARCH_ENGINE
    const stored = getSettings<SearchEngineId>(
      this.profileId,
      'searchEngine',
      DEFAULT_SEARCH_ENGINE
    )
    return isSearchEngineId(stored) ? stored : DEFAULT_SEARCH_ENGINE
  }

  /** Switch the window between normal and incognito browsing profiles. */
  setIncognito(incognito: boolean): void {
    this.incognito = incognito
    if (incognito && !this.incognitoPartition) {
      // Windows that started in normal mode get a fresh in-memory profile
      // the first time incognito is enabled; switching back keeps the
      // default persistent session for new tabs.
      this.incognitoPartition = `${INCOGNITO_PARTITION_PREFIX}${randomUUID()}`
    }
    this.attachIncognitoSession()
    this.tabs.refreshStartPages()
  }

  /**
   * Attach session-scoped integrations to the incognito partition: downloads
   * (never persisted to history) and the permission prompt handlers, which
   * are shared with the default session so behavior is consistent.
   */
  private attachIncognitoSession(): void {
    if (!this.incognitoPartition) return
    const ses = session.fromPartition(this.incognitoPartition)
    // Internal pages (voyager://start, settings assets) must resolve in the
    // incognito session's partition as well as the default session.
    registerVoyagerProtocol(ses.protocol)
    attachDownloadsTracking(
      ses,
      this.profileId,
      (state) => this.sendToChrome(IpcChannels.DownloadsStateChanged, state),
      { persist: false }
    )
    attachPermissionHandlers(ses, this.profileId)
  }

  /** Grow or shrink the chrome region for the bookmarks bar. */
  setBookmarksBarVisible(visible: boolean): void {
    this.bookmarksVisible = visible
    this.updateChromeHeight()
    this.applyLayout()
  }

  /** Switch between the horizontal tab strip and the vertical tab rail. */
  setVerticalTabs(enabled: boolean): void {
    if (this.verticalTabs === enabled) return
    this.verticalTabs = enabled
    if (!enabled) this.railExpanded = false
    this.updateChromeHeight()
    this.applyLayout()
  }

  /**
   * Expand the vertical rail over the page while the pointer is inside it so
   * the compact favicon strip can reveal tab labels without reflowing the page.
   */
  setRailExpanded(expanded: boolean): void {
    if (!this.verticalTabs || this.railExpanded === expanded) return
    this.railExpanded = expanded
    this.applyLayout()
  }

  /**
   * Recompute the chrome height for the current tab-strip mode and bookmarks
   * bar state. Vertical tabs put the toolbar at the top of the content area and
   * use the rail for tabs, so the horizontal tab strip height is not reserved.
   */
  private updateChromeHeight(): void {
    const base = this.verticalTabs ? TOOLBAR_HEIGHT : DEFAULT_CHROME_HEIGHT
    this.chromeHeight = base + bookmarksBarExtent(this.bookmarksVisible)
  }

  /** Flip the bookmarks bar and tell the chrome renderer about the new state. */
  toggleBookmarksBar(): void {
    toggleBookmarksBar(
      this.profileId,
      (state) => this.sendToChrome(IpcChannels.BookmarksStateChanged, state),
      (visible) => this.setBookmarksBarVisible(visible)
    )
  }

  /** Star the active page (or unstar it when the URL is already saved). */
  bookmarkActivePage(): void {
    const state = this.tabs.snapshot()
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
    if (!tab || isNewTab(tab.url)) return
    const existing = currentBookmarksState(this.profileId).items.find(
      (item) => item.url === tab.url && (item.folderId ?? null) === null
    )
    const publish = (next: ReturnType<typeof currentBookmarksState>): void => {
      for (const window of allWindows()) {
        if (window.profile === this.profileId) {
          window.sendToChrome(IpcChannels.BookmarksStateChanged, next)
        }
      }
    }
    if (existing) {
      removeBookmark(this.profileId, existing.id, publish, (visible) =>
        this.setBookmarksBarVisible(visible)
      )
      return
    }
    addBookmark(
      this.profileId,
      { title: tab.title || tab.url, url: tab.url, favicon: tab.favicon },
      publish,
      (visible) => this.setBookmarksBarVisible(visible)
    )
  }

  refreshClosedTabs(): void {
    createAppMenu(() => this)
  }

  tabIdForWebContents(webContents: WebContents): string | null {
    return this.tabs.tabIdForWebContents(webContents)
  }

  /**
   * Expand the chrome view over the whole window while an overlay is open so
   * dropdowns, palettes and menus are not clipped to the chrome strip. The
   * chrome background is transparent, so the page remains visible underneath.
   */
  setOverlayOpen(open: boolean): void {
    if (this.overlayOpen === open) return
    this.overlayOpen = open
    this.applyLayout()
  }

  attachTabView(view: WebContentsView): void {
    this.tabViews.add(view)
    this.window.contentView.addChildView(view)
    // Keep chrome topmost so expanded overlays always render above the page.
    this.window.contentView.addChildView(this.chrome)
    this.applyLayout()
  }

  detachTabView(view: WebContentsView): void {
    this.tabViews.delete(view)
    this.window.contentView.removeChildView(view)
    if (this.activeTabView === view) {
      this.activeTabView = null
    }
    this.applyLayout()
  }

  hideTabView(view: WebContentsView): void {
    view.setVisible(false)
  }

  showTabView(view: WebContentsView): void {
    this.activeTabView = view
    for (const other of this.tabViews) {
      other.setVisible(other === view)
    }
    view.webContents.focus()
    this.applyLayout()
  }

  /** Give keyboard focus to the chrome UI (tab strip + toolbar) view. */
  focusChrome(): void {
    if (this.disposed) return
    this.chrome.webContents.focus()
  }

  /** Send an event to the chrome renderer process. */
  sendToChrome(channel: string, payload?: unknown): void {
    if (this.disposed) return
    this.chrome.webContents.send(channel, payload)
  }

  /**
   * Focus the chrome view and ask the omnibox input to select its contents.
   * The page webContents owns keyboard focus while a page shortcut is handled,
   * so the view itself must be focused before the input can accept typing.
   */
  focusOmnibox(): void {
    if (this.disposed) return
    this.focusChrome()
    this.sendToChrome(IpcChannels.UiFocusOmnibox)
  }

  onDestroyed(callback: () => void): void {
    this.window.once('closed', callback)
  }

  /** Load the chrome renderer, restore the last session, and reveal the window. */
  async show(initialUrl?: string): Promise<void> {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (devServerUrl) {
      await this.chrome.webContents.loadURL(devServerUrl)
    } else {
      await this.chrome.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }
    this.restoreSession(initialUrl)
    this.window.show()
  }

  /** Focus this window and open `url` in a new active tab. */
  openUrl(url: string): void {
    if (this.disposed) return
    this.window.focus()
    this.tabs.create({ url, active: true })
  }

  /**
   * Replay the persisted tab set when the opt-in "restore session" preference
   * is enabled; otherwise start on the start page and drop any stale snapshot.
   * A URL passed on the command line opens as an extra active tab, regardless
   * of the restore preference.
   */
  private restoreSession(initialUrl?: string): void {
    const start = initialUrl ? { url: initialUrl } : {}
    if (this.incognito) {
      // Incognito starts with a clean slate and never restores persisted state.
      this.tabs.create(start)
      return
    }
    const sessionStore = storesFor(this.profileId).session
    if (getSettings(this.profileId, 'restoreSession', false) !== true) {
      // Drop any snapshot captured while restore was enabled so tabs do not
      // reappear if the preference is toggled back on later.
      sessionStore.set('tabs', [])
      sessionStore.set('activeIndex', 0)
      this.tabs.create(start)
      return
    }
    const { tabs, activeIndex } = sessionStore.snapshot
    if (tabs.length === 0) {
      this.tabs.create(start)
      return
    }
    const ids: string[] = []
    for (const tab of tabs) {
      // Start-page URLs contain settings captured at save time; recreate them
      // from the current engine instead of replaying stale query parameters.
      const request = isNewTab(tab.url) ? {} : { url: tab.url }
      const id = this.tabs.create({ ...request, active: false })
      if (tab.pinned) this.tabs.pinToggle(id)
      ids.push(id)
    }
    const index = Math.min(Math.max(activeIndex, 0), ids.length - 1)
    if (ids[index]) this.tabs.activate(ids[index])
    if (initialUrl) this.tabs.create({ url: initialUrl, active: true })
  }

  /** Save the current tab set so the next launch can restore it (opt-in). */
  private persistSession(state: BrowserState): void {
    if (this.incognito) return
    if (this.disposed) return
    if (getSettings(this.profileId, 'restoreSession', false) !== true) return
    const sessionStore = storesFor(this.profileId).session
    const entries = state.tabs.map((tab) => ({
      url: isNewTab(tab.url) ? DEFAULT_NEW_TAB_URL : tab.url,
      title: tab.title,
      pinned: tab.pinned
    }))
    const activeIndex = Math.max(
      0,
      state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    )
    sessionStore.set('tabs', entries)
    sessionStore.set('activeIndex', activeIndex)
  }

  /** Recompute chrome + content regions from the window's current size. */
  private handleWindowShapeChange = (): void => {
    this.applyLayout()
  }

  private applyLayout(): void {
    if (this.disposed) return
    const [width, height] = this.window.getContentSize()
    const railWidth = verticalRailExtent(this.verticalTabs)
    this.layout = computeLayout(width, height, this.chromeHeight, railWidth)

    // Vertical tabs need a full-window chrome view so the rail can run down the
    // left edge. The page view normally sits above it (leaving the rail and
    // toolbar visible) and is raised again whenever an overlay closes.
    const chromeOnTop = this.overlayOpen || (this.verticalTabs && this.railExpanded)
    const fullHeightChrome = this.verticalTabs || this.overlayOpen

    this.chrome.setBounds({
      x: 0,
      y: 0,
      width: this.layout.width,
      // Overlay mode spans the window so popups escape the chrome strip.
      height: fullHeightChrome ? this.layout.height : this.layout.chromeHeight
    })

    if (chromeOnTop) {
      this.window.contentView.addChildView(this.chrome)
    } else if (this.activeTabView) {
      // Raise the page above the transparent full-window chrome so clicks and
      // scrolling reach the page rather than the chrome renderer.
      this.window.contentView.addChildView(this.activeTabView)
    }

    this.activeTabView?.setBounds({
      x: this.layout.contentX,
      y: this.layout.contentY,
      width: this.layout.contentWidth,
      height: this.layout.contentHeight
    })
  }
}
