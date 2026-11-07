import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { WebContentsView, type WebContents, type Input } from 'electron'
import { DEFAULT_NEW_TAB_URL, SETTINGS_URL } from '../../shared/constants'
import { IpcChannels } from '../../shared/ipc-channels'
import { matchShortcut, type BrowserAction } from '../../shared/keyboard'
import type { BrowserState, NewTabRequest, TabState } from '../../shared/types'
import { currentHistoryState, recordVisit, updateHistoryTitle } from '../history/history'
import { openSettingsWindow } from '../window/settingsWindow'
import type { WindowController } from '../window/WindowController'

interface TabEntry {
  id: string
  view: WebContentsView
  title: string
  url: string
  loading: boolean
  favicon: string | null
  pinned: boolean
  muted: boolean
  hasAudio: boolean
  crashed: boolean
}

function isNewTab(url: string): boolean {
  return url === DEFAULT_NEW_TAB_URL || url === ''
}

function isInternalUrl(url: string): boolean {
  return url.startsWith('voyager://')
}

/**
 * Owns every tab in the window. Each tab is a sandboxed WebContentsView whose
 * lifecycle events are projected into a TabState snapshot; any change is
 * broadcast to the chrome renderer so it always mirrors reality.
 */
export class TabManager {
  private readonly entries = new Map<string, TabEntry>()
  private order: string[] = []
  private activeId: string | null = null
  private readonly closedTabs: { url: string; title: string }[] = []

  constructor(
    private readonly window: WindowController,
    private readonly onStateChanged: (state: BrowserState) => void
  ) {}

  get activeTabId(): string | null {
    return this.activeId
  }

  /** Resolve the tab that owns a WebContents, used for permission scoping. */
  tabIdForWebContents(webContents: WebContents): string | null {
    for (const [id, entry] of this.entries) {
      if (entry.view.webContents.id === webContents.id) return id
    }
    return null
  }

  snapshot(): BrowserState {
    const tabs: TabState[] = []
    for (const id of this.order) {
      const entry = this.entries.get(id)
      if (!entry) continue
      const wc = entry.view.webContents
      tabs.push({
        id,
        title: isNewTab(entry.url) ? 'New Tab' : entry.title,
        url: entry.url,
        loading: entry.loading,
        favicon: entry.favicon,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        pinned: entry.pinned,
        muted: entry.muted || wc.isAudioMuted(),
        hasAudio: entry.hasAudio,
        crashed: entry.crashed
      })
    }
    return { tabs, activeTabId: this.activeId }
  }

  create(request: NewTabRequest = {}): string {
    const webPreferences: {
      contextIsolation: boolean
      nodeIntegration: boolean
      sandbox: boolean
      preload: string
      partition?: string
    } = {
      preload: join(__dirname, '../preload/tab.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
    const partition = this.window.partition
    if (partition) webPreferences.partition = partition
    const view = new WebContentsView({ webPreferences })
    const entry: TabEntry = {
      id: randomUUID(),
      view,
      title: '',
      url: '',
      loading: false,
      favicon: null,
      pinned: false,
      muted: false,
      hasAudio: false,
      crashed: false
    }

    this.entries.set(entry.id, entry)
    this.order.push(entry.id)
    this.window.attachTabView(entry.view)
    this.wireEvents(entry)

    void entry.view.webContents.loadURL(request.url ?? DEFAULT_NEW_TAB_URL)

    if (request.active ?? true) {
      this.activate(entry.id)
      if (isNewTab(request.url ?? DEFAULT_NEW_TAB_URL)) {
        this.window.focusOmnibox()
      }
    } else {
      this.window.hideTabView(entry.view)
    }
    return entry.id
  }

  activate(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (this.activeId === id) {
      entry.view.webContents.focus()
      return
    }
    const previous = this.activeId
    this.activeId = id
    if (previous) {
      const previousEntry = this.entries.get(previous)
      if (previousEntry) this.window.hideTabView(previousEntry.view)
    }
    this.window.showTabView(entry.view)
    this.broadcast()
  }

  close(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return

    this.closedTabs.push({
      url: isNewTab(entry.url) ? DEFAULT_NEW_TAB_URL : entry.url,
      title: entry.title?.trim() || entry.url
    })
    if (this.closedTabs.length > 12) this.closedTabs.shift()
    this.window.refreshClosedTabs()

    const index = this.order.indexOf(id)
    this.order.splice(index, 1)
    this.entries.delete(id)

    this.window.detachTabView(entry.view)
    entry.view.webContents.close()

    if (this.activeId === id) {
      this.activeId = null
      const nextId = this.order[Math.min(index, this.order.length - 1)]
      if (nextId) {
        this.activate(nextId)
      } else {
        // Never leave the window tab-less; fall back to a fresh tab.
        this.create()
      }
    }
    this.broadcast()
  }

  reorder(ids: string[]): void {
    const known = ids.filter((id) => this.entries.has(id))
    const missing = this.order.filter((id) => !known.includes(id))
    this.order = [...known, ...missing]
    this.normalizeOrder()
    this.broadcast()
  }

  pinToggle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.pinned = !entry.pinned
    this.normalizeOrder()
    this.broadcast()
  }

  duplicate(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.create(isNewTab(entry.url) ? {} : { url: entry.url, active: true })
  }

  goBack(): void {
    const wc = this.activeWebContents()
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(): void {
    const wc = this.activeWebContents()
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(): void {
    this.activeWebContents()?.reload()
  }

  reloadIgnoringCache(): void {
    this.activeWebContents()?.reloadIgnoringCache()
  }

  /** Refresh every open page, e.g. after an explicit theme-mode change. */
  reloadAll(): void {
    for (const entry of this.entries.values()) {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.reload()
    }
  }

  stop(): void {
    this.activeWebContents()?.stop()
  }

  navigate(url: string): void {
    if (url.startsWith(SETTINGS_URL)) {
      openSettingsWindow()
      return
    }
    const wc = this.activeWebContents()
    if (!wc) return
    if (url.startsWith('javascript:')) {
      let code = url.slice('javascript:'.length)
      try {
        code = decodeURIComponent(code)
      } catch {
        // Leave malformed escapes untouched; executeJavaScript will report.
      }
      void wc.executeJavaScript(code, true).catch(() => undefined)
      return
    }
    void wc.loadURL(url)
  }

  findInPage(query: string, forward = true): void {
    this.activeWebContents()?.findInPage(query, { forward })
  }

  stopFindInPage(): void {
    this.activeWebContents()?.stopFindInPage('clearSelection')
  }

  zoomIn(): void {
    const wc = this.activeWebContents()
    if (!wc) return
    const current = wc.getZoomFactor()
    wc.setZoomFactor(Math.min(current + 0.1, 5.0))
  }

  zoomOut(): void {
    const wc = this.activeWebContents()
    if (!wc) return
    const current = wc.getZoomFactor()
    wc.setZoomFactor(Math.max(current - 0.1, 0.25))
  }

  zoomReset(): void {
    this.activeWebContents()?.setZoomFactor(1.0)
  }

  print(): void {
    this.activeWebContents()?.print()
  }

  async printToPdf(): Promise<Buffer | null> {
    const wc = this.activeWebContents()
    if (!wc) return null
    return wc.printToPDF({})
  }

  get isActiveLoading(): boolean {
    return this.entries.get(this.activeId ?? '')?.loading ?? false
  }

  reopenLastClosed(): void {
    const entry = this.closedTabs.pop()
    if (entry) this.create({ url: entry.url, active: true })
  }

  reopenClosedTab(index?: number): void {
    const entry =
      index === undefined
        ? this.closedTabs.pop()
        : this.closedTabs.splice(Math.max(0, Math.min(index, this.closedTabs.length - 1)), 1)[0]
    if (entry) this.create({ url: entry.url, active: true })
    this.window.refreshClosedTabs()
  }

  getClosedTabs(): { url: string; title: string }[] {
    return this.closedTabs.map((entry) => ({ url: entry.url, title: entry.title }))
  }

  toggleDevTools(): void {
    const wc = this.activeWebContents()
    if (!wc) return
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
    } else {
      wc.openDevTools()
    }
  }

  activateNth(n: number): void {
    const index = Math.min(Math.max(n, 1), this.order.length) - 1
    const id = this.order[index]
    if (id) this.activate(id)
  }

  activateNext(): void {
    if (this.order.length === 0) return
    const current = this.activeId ? this.order.indexOf(this.activeId) : -1
    this.activate(this.order[(current + 1) % this.order.length])
  }

  activatePrevious(): void {
    if (this.order.length === 0) return
    const current = this.activeId ? this.order.indexOf(this.activeId) : 0
    this.activate(this.order[(current - 1 + this.order.length) % this.order.length])
  }

  muteToggle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.muted = !entry.muted
    entry.view.webContents.setAudioMuted(entry.muted)
    this.broadcast()
  }

  closeOthers(id: string): void {
    for (const otherId of [...this.order]) {
      if (otherId !== id) this.close(otherId)
    }
  }

  closeToRight(id: string): void {
    const index = this.order.indexOf(id)
    if (index === -1) return
    for (const otherId of this.order.slice(index + 1)) this.close(otherId)
  }

  /** Pinned tabs always win the leftmost block, in their relative order. */
  private normalizeOrder(): void {
    const pinned = this.order.filter((id) => this.entries.get(id)?.pinned ?? false)
    const rest = this.order.filter((id) => !pinned.includes(id))
    this.order = [...pinned, ...rest]
  }

  private wireEvents(entry: TabEntry): void {
    const wc = entry.view.webContents

    // window.open and target=_blank become new tabs instead of new windows.
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(SETTINGS_URL)) {
        openSettingsWindow()
        return { action: 'deny' }
      }
      this.create({ url })
      return { action: 'deny' }
    })

    wc.addListener('will-navigate', (event, url) => {
      if (url.startsWith(SETTINGS_URL)) {
        event.preventDefault()
        openSettingsWindow()
        return
      }
      if (isInternalUrl(url)) {
        event.preventDefault()
        this.create({ url })
      }
    })

    // Browser shortcuts keep working while the page itself has focus.
    wc.on('before-input-event', (event, input) => {
      this.handleBeforeInput(event, input)
    })

    wc.on('page-title-updated', () => {
      const newTitle = wc.getTitle()
      entry.title = newTitle
      let changed = false
      if (entry.url.startsWith('http') && !isNewTab(entry.url) && !this.window.isIncognito) {
        if (updateHistoryTitle(entry.url, newTitle)) changed = true
        try {
          if (!changed) {
            // If navigation recording happened before the title existed, record it now.
            const state = currentHistoryState()
            if (!state.entries.some((item) => item.url === entry.url)) {
              recordVisit({ url: entry.url, title: newTitle || entry.url })
              changed = true
            }
          }
        } catch {
          // Ignore.
        }
      }
      if (changed) {
        try {
          this.window.sendToChrome(IpcChannels.HistoryStateChanged, currentHistoryState())
        } catch {
          // Ignore.
        }
      }
      this.broadcast()
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      entry.favicon = favicons[0] ?? null
      this.broadcast()
    })
    wc.on('did-start-loading', () => {
      entry.loading = true
      this.broadcast()
    })
    wc.on('did-stop-loading', () => {
      entry.loading = false
      this.broadcast()
    })
    wc.on('did-navigate', (_event, url) => {
      entry.url = url
      // Record history for main frame navigations to real pages.
      if (!isNewTab(url) && url.startsWith('http') && !this.window.isIncognito) {
        try {
          recordVisit({ url, title: wc.getTitle() || entry.title || url })
          this.window.sendToChrome(IpcChannels.HistoryStateChanged, currentHistoryState())
        } catch {
          // Ignore history write failures; navigation should not be blocked.
        }
      }
      this.broadcast()
    })
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        entry.url = url
        if (!isNewTab(url) && url.startsWith('http') && !this.window.isIncognito) {
          try {
            recordVisit({ url, title: entry.title || url })
            this.window.sendToChrome(IpcChannels.HistoryStateChanged, currentHistoryState())
          } catch {
            /* ignore */
          }
        }
        this.broadcast()
      }
    })
    wc.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
      if (isMainFrame) entry.url = url
      this.broadcast()
    })
    wc.on('render-process-gone', () => {
      entry.crashed = true
      this.broadcast()
    })
    wc.on('media-started-playing', () => {
      entry.hasAudio = true
      this.broadcast()
    })
    wc.on('media-paused', () => {
      entry.hasAudio = false
      this.broadcast()
    })
  }

  private broadcast(): void {
    this.onStateChanged(this.snapshot())
  }

  private handleBeforeInput(event: Electron.Event, input: Input): void {
    if (input.type !== 'keyDown') return
    const matched = matchShortcut(
      {
        key: input.key,
        code: input.code,
        meta: input.meta,
        ctrl: input.control,
        shift: input.shift,
        alt: input.alt
      },
      process.platform
    )
    if (!matched) return
    if (!this.canHandleShortcut(matched.action)) return
    event.preventDefault()
    this.performShortcut(matched.action, matched.index)
  }

  private canHandleShortcut(action: BrowserAction): boolean {
    if (action === 'stop') return this.isActiveLoading
    if (action === 'back') {
      return this.activeWebContents()?.navigationHistory.canGoBack() ?? false
    }
    if (action === 'forward') {
      return this.activeWebContents()?.navigationHistory.canGoForward() ?? false
    }
    return true
  }

  private performShortcut(action: BrowserAction, index?: number): void {
    switch (action) {
      case 'new-tab':
        this.create()
        break
      case 'close-tab':
        if (this.activeId) this.close(this.activeId)
        break
      case 'reopen-tab':
        this.reopenLastClosed()
        break
      case 'next-tab':
        this.activateNext()
        break
      case 'prev-tab':
        this.activatePrevious()
        break
      case 'select-tab-n':
        this.activateNth(index ?? 1)
        break
      case 'select-tab-last':
        this.activateNth(this.order.length)
        break
      case 'focus-omnibox':
        this.window.focusOmnibox()
        break
      case 'find-in-page':
        this.window.sendToChrome(IpcChannels.UiFindInPage)
        break
      case 'open-tab-search':
        this.window.sendToChrome(IpcChannels.UiOpenTabSearch)
        break
      case 'reload':
        this.reload()
        break
      case 'force-reload':
        this.reloadIgnoringCache()
        break
      case 'stop':
        this.stop()
        break
      case 'back':
        this.goBack()
        break
      case 'forward':
        this.goForward()
        break
      case 'toggle-bookmarks-bar':
        this.window.toggleBookmarksBar()
        break
      case 'bookmark-page':
        this.window.bookmarkActivePage()
        break
      case 'open-bookmarks-manager':
        this.window.sendToChrome(IpcChannels.UiOpenBookmarksManager)
        break
      case 'open-history':
        this.window.sendToChrome(IpcChannels.UiOpenHistory)
        break
      case 'open-downloads':
        this.window.sendToChrome(IpcChannels.UiOpenDownloads)
        break
      case 'open-settings':
        openSettingsWindow()
        break
      case 'dev-tools':
        this.toggleDevTools()
        break
    }
  }

  private activeWebContents(): WebContents | null {
    if (this.activeId === null) return null
    return this.entries.get(this.activeId)?.view.webContents ?? null
  }
}
