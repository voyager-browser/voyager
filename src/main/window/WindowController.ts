import { join } from 'node:path'
import { app, BaseWindow, WebContentsView, session, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IpcChannels } from '../../shared/ipc-channels'
import type { BrowserState } from '../../shared/types'
import { DEFAULT_PROFILE_ID, type ProfileInfo } from '../../shared/profiles'
import { DEFAULT_NEW_TAB_URL, INCOGNITO_PARTITION_PREFIX } from '../../shared/constants'
import { DEFAULT_SEARCH_ENGINE, isSearchEngineId, type SearchEngineId } from '../../shared/search'
import { isNewTab } from '../../shared/url'
import { getSettings, storesFor } from '../store'
import { clearContentBlockingSession } from '../contentBlocking/contentBlocking'
import {
  broadcastToProfile,
  configureIncognitoSession,
  ensureProfileSession
} from '../profiles/session'
import { profileById, profilePartition } from '../profiles/profiles'
import { publishExtensionTabState } from '../extensions/tabEvents'

import {
  currentBookmarksState,
  addBookmark,
  removeBookmark,
  toggleBookmarksBar
} from '../bookmarks/bookmarks'
import { setBookmarksBarVisibleForProfile } from './windowRegistry'

import { TabManager } from '../tabs/TabManager'
import { refreshAppMenu } from '../menu/menu'
import {
  DEFAULT_CHROME_HEIGHT,
  TOOLBAR_HEIGHT,
  bookmarksBarExtent,
  computeLayout,
  verticalRailExtent,
  type WindowLayout
} from './ChromeLayout'

function withDevSuffix(title: string): string {
  return app.isPackaged ? title : `${title} (Dev)`
}

/**
 * Owns the single application window. Chrome UI (tab strip + toolbar) lives in
 * a fixed-height WebContentsView pinned to the top of the content view, with the
 * active tab's WebContentsView filling the space below. macOS keeps native
 * traffic lights, Windows is frameless with custom controls, and Linux keeps
 * native decorations so the desktop environment owns its title bar and buttons.
 */
export class WindowController {
  readonly window: BaseWindow
  readonly chrome: WebContentsView
  readonly tabs: TabManager

  private readonly tabViews = new Set<WebContentsView>()
  private activeTabView: WebContentsView | null = null
  private splitSecondaryView: WebContentsView | null = null
  private chromeHeight = DEFAULT_CHROME_HEIGHT
  private bookmarksVisible = false
  private verticalTabs = false
  private railExpanded = false
  private overlayOpen = false
  private layout: WindowLayout
  private layoutSettleTimer: NodeJS.Timeout | null = null
  private extensionPanel: WebContentsView | null = null
  private extensionPanelBounds = { x: 0, y: 0, width: 0, height: 0 }
  private readonly extensionPanelClosedListeners = new Set<(owner: WindowController) => void>()
  private disposed = false
  private incognito: boolean
  private incognitoPartition: string | null
  private readonly profileId: string

  constructor(options: { incognito?: boolean; profileId?: string } = {}) {
    this.incognito = options.incognito ?? false
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID
    // Incognito profiles live in an in-memory session and are never persisted.
    this.incognitoPartition = this.incognito ? `${INCOGNITO_PARTITION_PREFIX}${randomUUID()}` : null
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
      title: withDevSuffix(this.incognito ? 'Incognito - Voyager' : 'Voyager'),
      backgroundColor: this.incognito ? '#101018' : '#1a1b22',
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 8, y: 13 } }
        : process.platform === 'win32'
          ? { frame: false as const }
          : { frame: true as const })
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
      publishExtensionTabState(this.profileId, this, state)
    })

    this.window.contentView.addChildView(this.chrome)

    // Re-lay out on every way the window can change shape, including native
    // fullscreen which does not always emit a plain 'resize' on macOS.
    this.window.on('resize', this.handleWindowShapeChange)
    this.window.on('maximize', this.handleWindowShapeChange)
    this.window.on('unmaximize', this.handleWindowShapeChange)
    this.window.on('enter-full-screen', this.handleWindowShapeChange)
    this.window.on('leave-full-screen', this.handleWindowShapeChange)

    // Cancel the post-show layout refresh as soon as teardown starts; the
    // timer must not re-enter the window while it is closing.
    this.window.on('close', () => this.cancelLayoutSettle())
    this.window.on('closed', () => {
      this.disposed = true
      this.cancelLayoutSettle()
      this.clearPrivateBlockingCounters()
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
    if (!incognito && this.incognitoPartition) this.clearPrivateBlockingCounters()
    this.incognito = incognito
    if (incognito && !this.incognitoPartition) {
      // Windows that started in normal mode get a fresh in-memory profile
      // the first time incognito is enabled; switching back keeps the
      // default persistent session for new tabs.
      this.incognitoPartition = `${INCOGNITO_PARTITION_PREFIX}${randomUUID()}`
    }
    if (this.incognito) this.attachIncognitoSession()
    else ensureProfileSession(this.profileId)
    this.tabs.refreshStartPages()
  }

  /**
   * Apply the owner's session policies to the incognito partition. Storage and
   * permission decisions remain ephemeral; proxy, spellcheck, UA and content
   * blocking match the normal profile session.
   */
  private attachIncognitoSession(): void {
    if (!this.incognitoPartition) return
    configureIncognitoSession(
      session.fromPartition(this.incognitoPartition),
      this.profileId,
      (state) => this.sendToChrome(IpcChannels.DownloadsStateChanged, state),
      this.incognitoPartition
    )
  }

  /** Private blocking counters live only as long as the incognito session. */
  private clearPrivateBlockingCounters(): void {
    if (!this.incognitoPartition) return
    clearContentBlockingSession(session.fromPartition(this.incognitoPartition))
  }

  /** Grow or shrink the chrome region for the bookmarks bar. */
  setBookmarksBarVisible(visible: boolean): void {
    this.bookmarksVisible = visible
    this.updateChromeHeight()
    this.applyLayout()
  }

  /** Set a user-defined window name (used by "Name Window..."). */
  setWindowTitle(title: string): void {
    this.window.setTitle(withDevSuffix(title.trim() || 'Voyager'))
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
   * bar state. Vertical tabs pin the toolbar across the top of the window and
   * put tabs in the rail below it, so no tab-strip height is reserved.
   */
  private updateChromeHeight(): void {
    const base = this.verticalTabs ? TOOLBAR_HEIGHT : DEFAULT_CHROME_HEIGHT
    this.chromeHeight = base + bookmarksBarExtent(this.bookmarksVisible)
  }

  /** Flip the bookmarks bar and update every window on this profile. */
  toggleBookmarksBar(): void {
    toggleBookmarksBar(
      this.profileId,
      (state) => broadcastToProfile(this.profileId, IpcChannels.BookmarksStateChanged, state),
      (visible) => setBookmarksBarVisibleForProfile(this.profileId, visible)
    )
  }

  /** Star the active page (or unstar it when the URL is already saved). */
  bookmarkActivePage(): void {
    const state = this.tabs.snapshot()
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
    if (!tab || isNewTab(tab.url)) return
    // Match the toolbar star: any bookmark for this URL counts, no matter
    // which folder holds it.
    const existing = currentBookmarksState(this.profileId).items.find(
      (item) => item.url === tab.url
    )
    const publish = (next: ReturnType<typeof currentBookmarksState>): void => {
      broadcastToProfile(this.profileId, IpcChannels.BookmarksStateChanged, next)
    }
    const resize = (visible: boolean): void =>
      setBookmarksBarVisibleForProfile(this.profileId, visible)
    if (existing) {
      removeBookmark(this.profileId, existing.id, publish, resize)
      return
    }
    addBookmark(
      this.profileId,
      { title: tab.title || tab.url, url: tab.url, favicon: tab.favicon },
      publish,
      resize
    )
  }

  refreshClosedTabs(): void {
    refreshAppMenu()
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

  /**
   * Show an extension menu or popup as a child view of this window, anchored
   * just below the toolbar button. This keeps the chrome view at its normal
   * height — expanding it was the cause of the blank tab-strip glitch — and
   * keeps the panel visually inside the browser like Chrome's UI.
   */
  /**
   * `x`/`y` are the bottom-right corner of the toolbar icon that opened the
   * panel, in window coordinates. The panel is aligned under that icon.
   */
  showExtensionPanel(options: {
    url: string
    session?: Session
    x: number
    y: number
    width: number
    height: number
    menuPayload?: unknown
    /** Extension documents must not receive the browser-management bridge. */
    restricted?: boolean
    /** Allow same-origin navigation within an extension popup. */
    allowedOrigin?: string
    onNavigateAway?: (url: string) => void
  }): void {
    this.closeExtensionPanel()
    if (this.disposed || this.window.isDestroyed()) return

    const view = new WebContentsView({
      webPreferences: {
        preload: join(
          __dirname,
          options.restricted ? '../preload/extensionPanel.js' : '../preload/index.js'
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        ...(options.session ? { session: options.session } : {})
      }
    })
    view.setBackgroundColor('#00000000')
    this.extensionPanel = view
    this.extensionPanelBounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height
    }
    this.window.contentView.addChildView(view)
    this.applyExtensionPanelBounds()

    view.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.closeExtensionPanel()
    })
    const sendMenuPayload = (): void => {
      if (this.extensionPanel === view && options.menuPayload !== undefined) {
        view.webContents.send(IpcChannels.ExtensionsMenuOpen, options.menuPayload)
      }
    }
    view.webContents.on('did-finish-load', sendMenuPayload)
    if (options.menuPayload !== undefined) {
      // The React listener mounts after the document finishes loading; resend
      // once so the panel always receives its anchor even on a fast first load.
      const retry = setTimeout(sendMenuPayload, 150)
      retry.unref()
    }
    if (options.onNavigateAway) {
      const onNavigateAway = options.onNavigateAway
      const allowedPrefix = options.allowedOrigin ?? options.url.split(/[?#]/)[0]
      view.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(allowedPrefix)) return
        event.preventDefault()
        onNavigateAway(url)
        this.closeExtensionPanel()
      })
    }
    void view.webContents.loadURL(options.url).catch((error) => {
      console.warn('[extensions] Could not open in-window panel:', error)
      if (this.extensionPanel === view) this.closeExtensionPanel()
    })
  }

  /** Whether `webContents` belongs to this window (chrome, tab, or panel). */
  ownsWebContents(webContents: WebContents | undefined | null): boolean {
    if (!webContents) return false
    if (this.chrome.webContents === webContents) return true
    if (this.extensionPanel?.webContents === webContents) return true
    return this.tabIdForWebContents(webContents) !== null
  }

  /** Whether `webContents` is the current extension menu or popup panel. */
  isExtensionPanelWebContents(webContents: WebContents): boolean {
    return this.extensionPanel?.webContents === webContents
  }

  /** Top-left of the panel in window coordinates, for anchoring native menus. */
  extensionPanelOrigin(): { x: number; y: number } | null {
    if (!this.extensionPanel) return null
    const bounds = this.extensionPanel.getBounds()
    return { x: bounds.x, y: bounds.y }
  }

  /** Observe every close path, including Escape, navigation and tab switches. */
  onExtensionPanelClosed(listener: (owner: WindowController) => void): () => void {
    this.extensionPanelClosedListeners.add(listener)
    return () => this.extensionPanelClosedListeners.delete(listener)
  }

  /** Dismiss the current extension menu or popup, if one is open. */
  closeExtensionPanel(): void {
    const view = this.extensionPanel
    if (!view) return
    this.extensionPanel = null
    this.window.contentView.removeChildView(view)
    view.webContents.close()
    for (const listener of [...this.extensionPanelClosedListeners]) listener(this)
  }

  private applyExtensionPanelBounds(): void {
    if (!this.extensionPanel || this.window.isDestroyed()) return
    const [windowWidth, windowHeight] = this.window.getContentSize()
    const { x, y, width, height } = this.extensionPanelBounds
    const panelWidth = Math.max(160, Math.min(width, windowWidth - 16))
    const panelHeight = Math.max(120, Math.min(height, windowHeight - 16))
    // Match Chrome: the panel's top-right corner sits just below the button.
    const left = x - panelWidth
    const top = y + 8
    this.extensionPanel.setBounds({
      x: Math.max(8, Math.min(Math.round(left), windowWidth - panelWidth - 8)),
      y: Math.max(8, Math.min(Math.round(top), windowHeight - panelHeight - 8)),
      width: panelWidth,
      height: panelHeight
    })
  }

  private raiseExtensionPanel(): void {
    if (this.extensionPanel && !this.window.isDestroyed()) {
      this.window.contentView.addChildView(this.extensionPanel)
    }
  }

  attachTabView(view: WebContentsView): void {
    this.tabViews.add(view)
    this.window.contentView.addChildView(view)
    // Keep chrome topmost so expanded overlays always render above the page.
    this.window.contentView.addChildView(this.chrome)
    this.applyLayout()
    this.raiseExtensionPanel()
  }

  detachTabView(view: WebContentsView): void {
    this.tabViews.delete(view)
    this.window.contentView.removeChildView(view)
    if (this.activeTabView === view) {
      this.activeTabView = null
    }
    if (this.splitSecondaryView === view) {
      this.splitSecondaryView = null
    }
    this.applyLayout()
    this.raiseExtensionPanel()
  }

  hideTabView(view: WebContentsView): void {
    if (view === this.splitSecondaryView) return
    view.setVisible(false)
  }

  showTabView(view: WebContentsView): void {
    // A toolbar panel belongs to the tab that opened it; switch tabs dismisses it.
    this.closeExtensionPanel()
    this.activeTabView = view
    for (const other of this.tabViews) {
      other.setVisible(other === view || other === this.splitSecondaryView)
    }
    view.webContents.focus()
    this.applyLayout()
    this.raiseExtensionPanel()
  }

  /** Show `view` as the secondary split pane, or clear it with null. */
  setSplitView(view: WebContentsView | null): void {
    const previous = this.splitSecondaryView
    this.splitSecondaryView = view
    if (previous && previous !== view && previous !== this.activeTabView) {
      previous.setVisible(false)
    }
    if (view) view.setVisible(true)
    this.applyLayout()
    this.raiseExtensionPanel()
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
    this.settleLayout()
  }

  /**
   * Native frames can apply their final extents after a window is mapped,
   * changing the content area without emitting a resize event. Refresh briefly
   * so chrome and page views settle to the real content area on every platform.
   */
  private settleLayout(attempts = 0): void {
    this.layoutSettleTimer = null
    if (this.disposed || this.window.isDestroyed() || attempts >= 10) return
    this.handleWindowShapeChange()
    if (this.disposed || this.window.isDestroyed()) return
    this.layoutSettleTimer = setTimeout(() => this.settleLayout(attempts + 1), 50)
  }

  /** Stop any pending post-show layout refresh. */
  private cancelLayoutSettle(): void {
    if (!this.layoutSettleTimer) return
    clearTimeout(this.layoutSettleTimer)
    this.layoutSettleTimer = null
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
    if (this.disposed || this.window.isDestroyed()) return
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
      // Raise the page(s) above the transparent full-window chrome so clicks
      // and scrolling reach them rather than the chrome renderer. Both split
      // panes need raising: setting bounds alone does not reroute input.
      this.window.contentView.addChildView(this.activeTabView)
      if (this.splitSecondaryView) {
        this.window.contentView.addChildView(this.splitSecondaryView)
      }
    }

    this.activeTabView?.setBounds({
      x: this.layout.contentX,
      y: this.layout.contentY,
      width: this.layout.contentWidth,
      height: this.layout.contentHeight
    })

    // Split view: active tab left, secondary tab right, equal widths.
    if (this.splitSecondaryView && this.activeTabView) {
      const leftWidth = Math.floor(this.layout.contentWidth / 2)
      this.activeTabView.setBounds({
        x: this.layout.contentX,
        y: this.layout.contentY,
        width: leftWidth,
        height: this.layout.contentHeight
      })
      this.splitSecondaryView.setBounds({
        x: this.layout.contentX + leftWidth,
        y: this.layout.contentY,
        width: this.layout.contentWidth - leftWidth,
        height: this.layout.contentHeight
      })
    }

    this.applyExtensionPanelBounds()
    this.raiseExtensionPanel()
  }
}
