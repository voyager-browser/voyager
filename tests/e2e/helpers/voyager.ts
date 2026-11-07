import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DEFAULT_NEW_TAB_URL } from '../../../src/shared/constants'
import type { BrowserState, TabState } from '../../../src/shared/types'
import { isNewTab } from '../../../src/shared/url'
import type { TestServer } from './server'

export type Modifier = 'shift' | 'control' | 'alt' | 'meta'

export interface LaunchOptions {
  userDataDir: string
  downloadDir: string
  seed?: Record<string, unknown>
  args?: string[]
}

export interface VoyagerApp {
  app: ElectronApplication
  chrome: Page
  tab: Page
  userDataDir: string
  downloadDir: string
  close(): Promise<void>
  pages(): Page[]
  tabPages(): Page[]
  tabPage(urlPart: string): Promise<Page>
  state(): Promise<BrowserState>
  activeTab(): Promise<TabState>
  waitForTab(predicate: (tab: TabState) => boolean, timeout?: number): Promise<TabState>
  navigate(url: string, expectedUrl?: string): Promise<TabState>
}

export function primaryModifier(): 'meta' | 'control' {
  return process.platform === 'darwin' ? 'meta' : 'control'
}

export function primaryKey(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

export async function pollUntil<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeout = 20_000,
  interval = 50
): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(interval)
  }
  throw new Error(`Timed out after ${timeout}ms waiting for condition`)
}

function isChromePage(page: Page): boolean {
  return /\/renderer\/index\.html(?:[?#]|$)/.test(page.url())
}

function isSettingsPage(page: Page): boolean {
  return page.url().startsWith('voyager://settings')
}

function isTabPage(page: Page): boolean {
  return !isChromePage(page) && !isSettingsPage(page) && !page.url().startsWith('devtools://')
}

async function waitForChrome(app: ElectronApplication): Promise<Page> {
  const chrome = await pollUntil(() =>
    app
      .windows()
      .filter((page) => !page.isClosed())
      .find(isChromePage)
  )
  await chrome.waitForSelector('#omnibox-input', { timeout: 20_000 })
  return chrome
}

async function waitForTab(app: ElectronApplication): Promise<Page> {
  return pollUntil(() =>
    app
      .windows()
      .filter((page) => !page.isClosed())
      .find(isTabPage)
  )
}

export function seedUserData(userDataDir: string, files: Record<string, unknown>): void {
  mkdirSync(userDataDir, { recursive: true })
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(userDataDir, `${name}.json`), JSON.stringify(value, null, 2))
  }
}

/**
 * Replace the main process clipboard writer with an in-memory recorder so
 * tests never overwrite the developer's real OS clipboard.
 */
async function installClipboardStub(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ clipboard }) => {
    const store = globalThis as unknown as { __voyagerE2EClipboard?: string }
    store.__voyagerE2EClipboard = ''
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      writable: true,
      value: (text: string) => {
        store.__voyagerE2EClipboard = text
      }
    })
  })
}

async function installDownloadHandler(
  app: ElectronApplication,
  downloadDir: string
): Promise<void> {
  mkdirSync(downloadDir, { recursive: true })
  await app.evaluate(({ session }, directory) => {
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSavePath(`${directory}/${item.getFilename()}`)
    })
  }, downloadDir)
}

const LAUNCH_RETRY_PATTERN = /ETXTBSY|EACCES|Failed to launch|failed to install correctly/

/**
 * Launching several Electron instances at once can transiently fail on busy
 * CI runners with ETXTBSY/EACCES while the binary is still being mapped.
 * Retry those spawn failures with a short backoff; real startup errors are
 * still surfaced immediately.
 */
async function launchWithRetry(
  options: Parameters<typeof electron.launch>[0],
  attempts = 8
): Promise<ElectronApplication> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await electron.launch(options)
    } catch (error) {
      lastError = error
      const message = String((error as Error)?.message ?? error)
      if (attempt === attempts || !LAUNCH_RETRY_PATTERN.test(message)) throw error
      await delay(attempt * 1_000)
    }
  }
  throw lastError
}

export async function launchVoyager(options: LaunchOptions): Promise<VoyagerApp> {
  if (options.seed) seedUserData(options.userDataDir, options.seed)
  mkdirSync(options.downloadDir, { recursive: true })

  const env = {
    ...process.env,
    VOYAGER_E2E: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
  } as Record<string, string>

  const app = await launchWithRetry({
    args: [
      '.',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${options.userDataDir}`,
      '--host-resolver-rules=MAP insecure.test 127.0.0.1',
      ...(options.args ?? [])
    ],
    cwd: process.cwd(),
    env
  })

  await installClipboardStub(app)
  const chrome = await waitForChrome(app)
  await installDownloadHandler(app, options.downloadDir)
  const tab = await waitForTab(app)

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await app.close().catch(() => undefined)
  }

  const voyager: VoyagerApp = {
    app,
    chrome,
    tab,
    userDataDir: options.userDataDir,
    downloadDir: options.downloadDir,
    close,
    pages: () => app.windows().filter((page) => !page.isClosed()),
    tabPages: () => app.windows().filter((page) => !page.isClosed() && isTabPage(page)),
    tabPage: (urlPart) =>
      pollUntil(() =>
        app
          .windows()
          .filter((page) => !page.isClosed())
          .find((page) => page.url().includes(urlPart))
      ),
    state: () => chrome.evaluate(() => window.voyager.tabs.getState()),
    activeTab: async () => {
      const state = await voyageState(chrome)
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
      if (!tab) throw new Error('No active tab')
      return tab
    },
    waitForTab: (predicate, timeout) =>
      pollUntil(async () => {
        try {
          const tab = await voyager.activeTab()
          return predicate(tab) ? tab : undefined
        } catch {
          return undefined
        }
      }, timeout),
    navigate: async (url, expectedUrl = url) => {
      let issued = false
      return pollUntil(
        async () => {
          try {
            const before = await voyager.activeTab()
            if (!issued || (before.url !== expectedUrl && !before.loading)) {
              issued = true
              await chrome.evaluate((target) => window.voyager.navigation.go(target), url)
            }
            const tab = await voyager.activeTab()
            return tab.url === expectedUrl && !tab.loading ? tab : undefined
          } catch {
            return undefined
          }
        },
        20_000,
        250
      )
    }
  }

  return voyager
}

async function voyageState(chrome: Page): Promise<BrowserState> {
  return chrome.evaluate(() => window.voyager.tabs.getState())
}

/**
 * Assert that a live tab webContents has rendered the expected text.
 *
 * Playwright's Page handles for Electron WebContentsViews can go stale when a
 * tab is closed and reopened (or navigated) and then hang forever on locator
 * calls. Query the main process for the webContents that currently owns the
 * URL instead, racing each evaluation with a short timeout so a stale view
 * cannot stall the poll.
 */
export async function waitForRenderedText(
  voyager: VoyagerApp,
  url: string,
  selector: string,
  expectedText: string,
  timeout = 20_000
): Promise<void> {
  await expect
    .poll(
      async () =>
        voyager.app.evaluate(
          async ({ webContents }, input) => {
            const targets = webContents
              .getAllWebContents()
              .filter((contents) => !contents.isDestroyed() && contents.getURL() === input.url)
            for (const contents of targets) {
              try {
                const text = await Promise.race([
                  contents.executeJavaScript(
                    `document.querySelector(${JSON.stringify(input.selector)})?.textContent ?? ''`
                  ),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000))
                ])
                if ((text ?? '').trim() === input.expectedText) return true
              } catch {
                // The view may have been replaced; try the next matching one.
              }
            }
            return false
          },
          { url, selector, expectedText }
        ),
      { timeout }
    )
    .toBe(true)
}

export async function waitForTabCount(voyager: VoyagerApp, count: number): Promise<void> {
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(count)
}

export async function pressPageShortcut(
  voyager: VoyagerApp,
  keyCode: string,
  modifiers: Modifier[] = []
): Promise<void> {
  const normalized = modifiers.map((modifier) =>
    process.platform === 'darwin' || modifier !== 'meta' ? modifier : 'control'
  )
  const state = await voyager.state()
  const activeUrl = state.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? ''
  const wantsBlank = !activeUrl || isNewTab(activeUrl)
  await voyager.app.evaluate(
    ({ BaseWindow, webContents }, input) => {
      const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      window?.focus()
      const candidates = webContents.getAllWebContents().filter((contents) => {
        const url = contents.getURL()
        return (
          !contents.isDestroyed() &&
          !url.startsWith('file:') &&
          !/^voyager:\/\/settings([#?/]|$)/.test(url) &&
          !url.startsWith('devtools:')
        )
      })
      const isBlankUrl = (url: string): boolean =>
        url === '' ||
        url === 'about:blank' ||
        url === input.startUrl ||
        url.startsWith(`${input.startUrl}?`)
      const target =
        (input.wantsBlank
          ? candidates.find((contents) => isBlankUrl(contents.getURL()))
          : candidates.find((contents) => contents.getURL() === input.activeUrl)) ??
        candidates.find((contents) => contents.isFocused()) ??
        candidates[0]
      if (!target) throw new Error('No tab web contents available')
      target.focus()
      const kc =
        input.keyCode === 'ArrowLeft'
          ? 'Left'
          : input.keyCode === 'ArrowRight'
            ? 'Right'
            : input.keyCode
      target.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: input.modifiers })
      target.sendInputEvent({ type: 'keyUp', keyCode: kc, modifiers: input.modifiers })
    },
    { keyCode, modifiers: normalized, activeUrl, wantsBlank, startUrl: DEFAULT_NEW_TAB_URL }
  )
}

export async function chromeBounds(
  voyager: VoyagerApp
): Promise<{ x: number; y: number; width: number; height: number }> {
  return voyager.app.evaluate(({ BaseWindow, WebContentsView }) => {
    const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('No BrowserWindow found')
    const chrome = window.contentView.children.find(
      (view) => view instanceof WebContentsView && view.webContents.getURL().startsWith('file:')
    )
    if (!chrome) throw new Error('Chrome view not found')
    return chrome.getBounds()
  })
}

export async function waitForSettingsWindow(app: ElectronApplication): Promise<Page> {
  const page = await pollUntil(() =>
    app
      .windows()
      .filter((candidate) => !candidate.isClosed())
      .find(isSettingsPage)
  )
  await page.waitForSelector('h1', { timeout: 20_000 })
  return page
}

export async function openSettings(voyager: VoyagerApp): Promise<Page> {
  await voyager.chrome.evaluate(() => window.voyager.settings.open())
  return waitForSettingsWindow(voyager.app)
}

export async function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ BaseWindow }) => BaseWindow.getAllWindows().filter((window) => !window.isDestroyed()).length
  )
}

export async function clipboardText(app: ElectronApplication): Promise<string> {
  return app.evaluate(
    () => (globalThis as unknown as { __voyagerE2EClipboard?: string }).__voyagerE2EClipboard ?? ''
  )
}

export async function devToolsOpen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.isDevToolsOpened())
  )
}

export async function activeZoom(voyager: VoyagerApp): Promise<number> {
  const tab = await voyager.activeTab()
  return voyager.app.evaluate(({ webContents }, url) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL() === url && !candidate.getURL().startsWith('file:'))
    return contents?.getZoomFactor() ?? 0
  }, tab.url)
}

export async function interceptSearch(voyager: VoyagerApp, server: TestServer): Promise<void> {
  await voyager.app.evaluate(
    ({ session }, targets) => {
      const store = globalThis as unknown as { __searchRequests?: string[] }
      store.__searchRequests = []
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['https://duckduckgo.com/*'] },
        (details, callback) => {
          store.__searchRequests?.push(details.url)
          const url = new URL(details.url)
          const query = url.searchParams.get('q') ?? ''
          const target = url.pathname.startsWith('/ac') ? targets.suggest : targets.search
          callback({ redirectURL: `${target}?q=${encodeURIComponent(query)}` })
        }
      )
    },
    { search: server.url('/search'), suggest: server.url('/suggest') }
  )
}

export async function searchRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const store = globalThis as unknown as { __searchRequests?: string[] }
    return store.__searchRequests ?? []
  })
}

export async function waitForJson<T>(
  path: string,
  predicate: (value: T) => boolean,
  timeout = 15_000
): Promise<T> {
  return pollUntil(() => {
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8')) as T
      return predicate(value) ? value : undefined
    } catch {
      return undefined
    }
  }, timeout)
}
