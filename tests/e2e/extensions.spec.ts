import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  crx2,
  deflatedZip,
  signedExtensionCrx,
  storedZip,
  storedZip64,
  testCrxSigner
} from './helpers/crx'
import {
  liveExtensionPage,
  openSettings,
  pollUntil,
  windowCount,
  type VoyagerApp
} from './helpers/voyager'

const EXTENSIONS_DIR = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'extensions')
const EXTENSION_PATH = join(EXTENSIONS_DIR, 'password-filler')
const MV2_NATIVE_EXTENSION_PATH = join(EXTENSIONS_DIR, 'native-messaging-mv2')
const WORKER_EXTENSION_PATH = join(EXTENSIONS_DIR, 'worker-permissions')
const WEB_NAVIGATION_EXTENSION_PATH = join(EXTENSIONS_DIR, 'web-navigation')
const CRX_PATH = join(EXTENSIONS_DIR, 'password-filler.crx')
const NATIVE_HOST_PATH = join(EXTENSION_PATH, 'nativeHost.js')

/** Probe the permission API without hanging forever if a prompt appears. */
async function probeNativeMessagingPermission(popup: Page): Promise<{
  all: string[]
  contains: boolean
  request: unknown
}> {
  return popup.evaluate(async () => {
    const permissions = (globalThis as any).chrome.permissions
    const all = await permissions.getAll()
    const contains = await permissions.contains({ permissions: ['nativeMessaging'] })
    const request = await Promise.race([
      permissions.request({ permissions: ['nativeMessaging'] }),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 2000))
    ])
    return { all: all?.permissions ?? [], contains, request }
  })
}

const ILLEGAL_NAMES_CRX = crx2(
  storedZip([
    {
      name: 'manifest.json',
      content: Buffer.from(
        JSON.stringify({ manifest_version: 2, name: 'Illegal Names', version: '1.0' })
      )
    },
    { name: 'desktop.ini', content: Buffer.from('[.ShellClassInfo]') },
    { name: '_metadata/verified_contents.json', content: Buffer.from('{}') }
  ])
)

const ZIP64_CRX = crx2(
  storedZip64([
    {
      name: 'manifest.json',
      content: Buffer.from(
        JSON.stringify({ manifest_version: 2, name: 'ZIP64 Extension', version: '1.0' })
      )
    },
    { name: 'zip64.txt', content: Buffer.from('ZIP64 payload') }
  ])
)

/** Bottom-right corner of a toolbar button, in window coordinates. */
async function buttonAnchor(voyager: VoyagerApp, label: string): Promise<{ x: number; y: number }> {
  return voyager.chrome.evaluate((name) => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === name
    )
    const rect = button?.getBoundingClientRect()
    return { x: rect?.right ?? 0, y: rect?.bottom ?? 0 }
  }, label)
}

/** Bounds of the in-window child view whose URL starts with `prefix`. */
async function panelBounds(
  voyager: VoyagerApp,
  prefix: string
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return voyager.app.evaluate(({ webContents, BaseWindow }, urlPrefix) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith(urlPrefix))
    if (!contents) return null
    for (const window of BaseWindow.getAllWindows()) {
      const view = window.contentView.children.find(
        (child) => (child as unknown as { webContents?: unknown }).webContents === contents
      )
      if (view) return view.getBounds()
    }
    return null
  }, prefix)
}

test('runs content scripts from an unpacked extension installed at startup', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })

  const state = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  expect(state).toEqual([
    expect.objectContaining({
      name: 'Voyager E2E Password Filler',
      path: EXTENSION_PATH,
      loaded: true
    })
  ])
  expect(state[0]?.action?.iconUrl).toMatch(/^data:image\/png;base64,/)

  const input = voyager.chrome.locator('#omnibox-input')
  await input.fill(server.url('/home'))
  await input.press('Enter')
  await voyager.waitForTab((tab) => tab.url === server.url('/home'))
  await expect(voyager.tab.locator('#voyager-e2e-extension')).toBeAttached({ timeout: 15_000 })
})

test('installs and removes an unpacked extension for the profile', async ({ voyager }) => {
  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    EXTENSION_PATH
  )
  expect(installed).toEqual([
    expect.objectContaining({ name: 'Voyager E2E Password Filler', loaded: true })
  ])

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    EXTENSION_PATH
  )
  expect(removed).toEqual([])
})

test('confirms Settings installs in the browser window with plain-language access', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager()
  const settings = await openSettings(voyager)

  const cancelled = settings.evaluate(
    (path) => window.voyager.extensions.install(path),
    EXTENSION_PATH
  )
  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Add Voyager E2E Password Filler?')
  await expect(prompt).toContainText('See your browsing tabs and activity')
  await expect(prompt).toContainText('cooperate with native apps')
  await expect(prompt).toContainText('Access https://example.test/*')
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await cancelled).toEqual([])
  await expect(voyager.chrome.getByRole('dialog')).toHaveCount(0)

  const accepted = settings.evaluate(
    (path) => window.voyager.extensions.install(path),
    EXTENSION_PATH
  )
  const secondPrompt = voyager.chrome.getByRole('dialog')
  await expect(secondPrompt).toBeVisible()
  await secondPrompt.getByRole('button', { name: 'Install extension' }).click()
  expect(await accepted).toEqual([
    expect.objectContaining({ name: 'Voyager E2E Password Filler', loaded: true })
  ])
})

test('unpacks and installs a CRX extension', async ({ voyager }) => {
  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    CRX_PATH
  )
  expect(installed).toEqual([
    expect.objectContaining({
      name: 'Voyager E2E Password Filler',
      loaded: true
    })
  ])
  expect(installed[0].path).not.toBe(CRX_PATH)

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    installed[0].path
  )
  expect(removed).toEqual([])
})

test('unpacks a ZIP64 CRX extension', async ({ voyager, downloadDir }) => {
  const crxPath = join(downloadDir, 'zip64.crx')
  writeFileSync(crxPath, ZIP64_CRX)

  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    crxPath
  )
  expect(installed).toEqual([expect.objectContaining({ name: 'ZIP64 Extension', loaded: true })])

  const extensionPath = installed[0]?.path
  expect(extensionPath).toBeTruthy()
  if (!extensionPath) return
  expect(readFileSync(join(extensionPath, 'zip64.txt'), 'utf8')).toBe('ZIP64 payload')

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    extensionPath
  )
  expect(removed).toEqual([])
})

test('installs a CRX with a file larger than the previous 64 MiB limit', async ({
  voyager,
  downloadDir
}) => {
  const largeSize = 64 * 1024 * 1024 + 1
  const largeFile = Buffer.alloc(largeSize, 0x5a)
  const crxPath = join(downloadDir, 'large.crx')
  writeFileSync(
    crxPath,
    crx2(
      storedZip([
        {
          name: 'manifest.json',
          content: Buffer.from(
            JSON.stringify({ manifest_version: 2, name: 'Large CRX Extension', version: '1.0' })
          )
        },
        { name: 'large.bin', content: largeFile }
      ])
    )
  )

  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    crxPath
  )
  expect(installed).toEqual([
    expect.objectContaining({ name: 'Large CRX Extension', loaded: true })
  ])

  const extensionPath = installed[0]?.path
  expect(extensionPath).toBeTruthy()
  if (!extensionPath) return
  expect(statSync(join(extensionPath, 'large.bin')).size).toBe(largeSize)

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    extensionPath
  )
  expect(removed).toEqual([])
})

test('unpacks and installs a signed CRX3 extension', async ({ voyager, downloadDir }) => {
  const signer = testCrxSigner()
  const crxPath = join(downloadDir, 'signed.crx')
  writeFileSync(
    crxPath,
    signedExtensionCrx(
      { manifest_version: 3, name: 'Signed CRX3 Extension', version: '1.0' },
      signer
    )
  )

  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    crxPath
  )
  expect(installed).toEqual([
    expect.objectContaining({ name: 'Signed CRX3 Extension', loaded: true })
  ])

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    installed[0].path
  )
  expect(removed).toEqual([])
})

test('rejects a CRX whose declared uncompressed size exceeds the budget', async ({
  voyager,
  downloadDir
}) => {
  const crxPath = join(downloadDir, 'lying-size.crx')
  writeFileSync(
    crxPath,
    crx2(
      storedZip([
        {
          name: 'manifest.json',
          content: Buffer.from(
            JSON.stringify({ manifest_version: 2, name: 'Lying Size', version: '1.0' })
          )
        },
        { name: 'huge.bin', content: Buffer.from('small'), declaredSize: 2 * 1024 * 1024 * 1024 }
      ])
    )
  )

  await expect(
    voyager.chrome.evaluate((path) => window.voyager.extensions.install(path), crxPath)
  ).rejects.toThrow(/budget/i)
})

test('rejects a deflated CRX entry that expands past its declared size', async ({
  voyager,
  downloadDir
}) => {
  const manifest = Buffer.from(
    JSON.stringify({ manifest_version: 2, name: 'Deflate Bomb', version: '1.0' })
  )
  const crxPath = join(downloadDir, 'deflate-bomb.crx')
  writeFileSync(
    crxPath,
    crx2(
      deflatedZip([
        {
          name: 'manifest.json',
          compressed: deflateRawSync(manifest),
          uncompressedSize: manifest.length
        },
        {
          name: 'bomb.bin',
          compressed: deflateRawSync(Buffer.alloc(8 * 1024 * 1024, 0)),
          uncompressedSize: 16
        }
      ])
    )
  )

  await expect(
    voyager.chrome.evaluate((path) => window.voyager.extensions.install(path), crxPath)
  ).rejects.toThrow(/budget|decompress/i)
})

test('strips illegal Windows metadata from unpacked CRX extensions', async ({
  voyager,
  downloadDir
}) => {
  const crxPath = join(downloadDir, 'illegal-names.crx')
  writeFileSync(crxPath, ILLEGAL_NAMES_CRX)

  const installed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    crxPath
  )
  expect(installed).toEqual([expect.objectContaining({ name: 'Illegal Names', loaded: true })])

  const extensionPath = installed[0]?.path
  expect(extensionPath).toBeTruthy()
  if (!extensionPath) return
  expect(existsSync(join(extensionPath, 'desktop.ini'))).toBe(false)
  expect(existsSync(join(extensionPath, '_metadata'))).toBe(false)

  const removed = await voyager.chrome.evaluate(
    (path) => window.voyager.extensions.uninstall(path),
    extensionPath
  )
  expect(removed).toEqual([])
})

test('cleans illegal metadata from managed unpacks at startup', async ({
  launchVoyager,
  userDataDir
}) => {
  const extensionPath = join(userDataDir, 'unpacked-extensions', 'default', 'legacy-unpack')
  mkdirSync(extensionPath, { recursive: true })
  cpSync(EXTENSION_PATH, extensionPath, { recursive: true })
  const illegalFile = join(extensionPath, 'desktop.ini')
  writeFileSync(illegalFile, '[.ShellClassInfo]\r\n')

  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [extensionPath] } }
  })
  const state = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  expect(state).toEqual([
    expect.objectContaining({
      name: 'Voyager E2E Password Filler',
      path: extensionPath,
      loaded: true
    })
  ])
  expect(existsSync(illegalFile)).toBe(false)
})

test('opens an extension action popup inside the browser window', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()
  const before = await windowCount(voyager.app)

  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  // The popup is an in-window child view, not a second BrowserWindow.
  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) => contents.getURL().startsWith('chrome-extension://'))
      )
    )
    .toBe(true)
  expect(await windowCount(voyager.app)).toBe(before)

  const popupText = await voyager.app.evaluate(({ webContents }) => {
    const popup = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('chrome-extension://'))
    return popup?.executeJavaScript(
      "document.querySelector('#voyager-extension-popup')?.textContent ?? ''"
    )
  })
  expect(popupText).toBe('password-filler-popup')

  // The chrome view must stay at its normal size: expanding it over the whole
  // window is what previously blanked the tab strip and blocked dragging.
  await expect(voyager.chrome.getByRole('tab')).toBeVisible()
  await expect(voyager.chrome.getByRole('button', { name: 'Extensions' })).toBeVisible()
})

test('opens a Voyager tab when an extension calls chrome.tabs.create', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate(async (extensionId) => {
    await window.voyager.extensions.setSiteAccess(extensionId, 'all')
    await window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Open tab' }).click()

  // Activating the new tab dismisses the action popup, just as Chrome does, so
  // assert the resulting Voyager tab rather than the popup's own DOM.
  await expect
    .poll(async () =>
      (await voyager.state()).tabs.some((tab) => tab.url.startsWith('https://example.test/'))
    )
    .toBe(true)
})

test('maps chrome.tabs queries and actions to Voyager tabs', async ({ launchVoyager, server }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate(async (extensionId) => {
    await window.voyager.extensions.setSiteAccess(extensionId, 'all')
  }, id)
  for (const path of ['/home', '/second', '/third']) {
    await voyager.chrome.evaluate(
      async (url) => window.voyager.tabs.create({ url, active: false }),
      server.url(path)
    )
  }
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect.poll(async () => Boolean(await liveExtensionPage(voyager.app))).toBe(true)
  await pollUntil(async () => {
    const live = await liveExtensionPage(voyager.app)
    if (!live) return undefined
    try {
      await live.getByRole('button', { name: 'Probe tabs' }).click()
      return true
    } catch {
      return undefined
    }
  })

  await expect
    .poll(async () => {
      const live = await liveExtensionPage(voyager.app)
      if (!live) return null
      try {
        const text = await live.locator('#tabs-probe-result').textContent()
        if (!text || text === 'No tabs probed') return null
        return JSON.parse(text)
      } catch {
        return null
      }
    })
    .toMatchObject({ pinned: true, firstMoved: true, zoomApplied: true, removed: true })
  await expect.poll(async () => (await voyager.state()).tabs[0]?.url).toBe(server.url('/second'))
  await expect
    .poll(
      async () =>
        (await voyager.state()).tabs.find((tab) => tab.url === server.url('/second'))?.pinned
    )
    .toBe(true)
  await expect
    .poll(async () => (await voyager.state()).tabs.some((tab) => tab.url === server.url('/third')))
    .toBe(false)
})

test('opens an extension settings page as a Voyager tab', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  expect(
    await popup!.evaluate(() => typeof (globalThis as any).chrome.runtime?.openOptionsPage)
  ).toBe('function')

  await popup!.getByRole('button', { name: 'Open settings' }).click()

  await expect
    .poll(async () => {
      const state = await voyager.state()
      return state.tabs.some((tab) => tab.url.includes(`${id}/options.html`))
    })
    .toBe(true)
  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().includes(`${id}/options.html`)))
    .toBe(true)
  const optionsPage = voyager.app
    .windows()
    .find((page) => page.url().includes(`${id}/options.html`))
  await expect(optionsPage!.getByText('extension-options-page')).toBeVisible()
})

test('opens its action popup when an extension calls chrome.action.openPopup', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect.poll(async () => Boolean(await liveExtensionPage(voyager.app))).toBe(true)
  const popup = await liveExtensionPage(voyager.app)
  const shims = await popup!.evaluate(() => ({
    action: typeof (globalThis as any).chrome.action?.openPopup,
    browserAction: typeof (globalThis as any).chrome.browserAction?.openPopup
  }))
  expect(shims.action).toBe('function')
  expect(shims.browserAction).toBe('function')

  const initialCount = Number(await popup!.locator('#popup-open-count').textContent())
  await pollUntil(async () => {
    const live = await liveExtensionPage(voyager.app)
    if (!live) return undefined
    try {
      await live.getByRole('button', { name: 'Request popup' }).click()
      return true
    } catch {
      return undefined
    }
  })
  await expect
    .poll(async () => {
      const reopened = await liveExtensionPage(voyager.app)
      if (!reopened) return null
      try {
        return Number(await reopened.locator('#popup-open-count').textContent())
      } catch {
        return null
      }
    })
    .toBe(initialCount + 1)
})

test('serves permission IPC from an MV3 background service worker', async ({ launchVoyager }) => {
  // Voyager enables the sandboxed renderer client at startup so this worker's
  // preload runs without any test-only command-line flags.
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [WORKER_EXTENSION_PATH] } }
  })

  await expect
    .poll(async () => (await voyager.state()).tabs.some((tab) => tab.url.endsWith('/probe.html')), {
      timeout: 15_000
    })
    .toBe(true)
})

test('prompts before granting a new extension permission', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Request privacy access' }).click()

  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toContainText('Change your privacy-related settings')
  await prompt.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(prompt).toHaveCount(0)

  // The extension page stays alive while the chrome prompt is answered, so the
  // permission callback can report the persisted decision.
  await expect(popup!.locator('#permission-result')).toHaveText('permission granted')

  // Bitwarden-style privacy settings must be reachable after the grant and
  // must persist without showing the same prompt again.
  await popup!.getByRole('button', { name: 'Disable password saving' }).click()
  await expect(popup!.locator('#privacy-result')).toHaveText('password saving off')
  const setting = await popup!.evaluate(() =>
    (globalThis as any).chrome.privacy.services.passwordSavingEnabled.get({})
  )
  expect(setting.value).toBe(false)
})

test('exchanges native messages between an extension and a native host', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()

  await voyager.chrome.evaluate(
    ({ extensionId, hostPath }) =>
      window.voyager.extensions.setNativeHosts([
        {
          name: 'com.voyager.e2e',
          path: hostPath,
          allowedOrigins: [`chrome-extension://${extensionId}/`]
        }
      ]),
    { extensionId: id, hostPath: NATIVE_HOST_PATH }
  )

  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)
  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))

  await popup!.getByRole('button', { name: 'Send native message' }).click()
  await expect(popup!.locator('#native-result')).toHaveText('one-shot')

  await popup!.getByRole('button', { name: 'Connect native port' }).click()
  await expect(popup!.locator('#native-port-result')).toHaveText('port')
})

test('discovers Chrome native messaging host manifests', async ({ launchVoyager, userDataDir }) => {
  const hostsDir = join(userDataDir, 'chrome-native-hosts')
  mkdirSync(hostsDir, { recursive: true })
  writeFileSync(
    join(hostsDir, 'com.voyager.e2e.json'),
    JSON.stringify({
      name: 'com.voyager.e2e',
      description: 'Chrome-style host manifest for E2E',
      path: NATIVE_HOST_PATH,
      type: 'stdio',
      allowed_origins: ['*']
    })
  )

  const voyager = await launchVoyager({
    env: { VOYAGER_CHROME_NATIVE_HOSTS_DIR: hostsDir },
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Send native message' }).click()
  await expect(popup!.locator('#native-result')).toHaveText('one-shot')
})

test('auto-grants nativeMessaging from an MV3 manifest without prompting', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))

  const result = await probeNativeMessagingPermission(popup!)
  expect(result.all).toContain('nativeMessaging')
  expect(result.contains).toBe(true)
  expect(result.request).toBe(true)
  await expect(voyager.chrome.getByRole('dialog')).toHaveCount(0)

  // Unrelated optional permissions must still go through the normal prompt.
  await popup!.getByRole('button', { name: 'Request privacy access' }).click()
  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toContainText('Change your privacy-related settings')
  await prompt.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(prompt).toHaveCount(0)
})

test('auto-grants nativeMessaging from an MV2 manifest without prompting', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [MV2_NATIVE_EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()

  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))

  const result = await probeNativeMessagingPermission(popup!)
  expect(result.all).toContain('nativeMessaging')
  expect(result.contains).toBe(true)
  expect(result.request).toBe(true)
  await expect(voyager.chrome.getByRole('dialog')).toHaveCount(0)
})

test('opens a Chrome-style HTML extension menu with grouped actions', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  await expect(voyager.chrome.getByRole('button', { name: 'Extensions' })).toBeVisible()
  const opened = await voyager.chrome.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Extensions'
    )
    const rect = button?.getBoundingClientRect()
    return window.voyager.extensions.showActionMenu(rect?.right ?? 0, rect?.bottom ?? 0)
  })
  expect(opened).toBe(true)

  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (contents) =>
              contents.getURL().includes('extensionMenu.html') ||
              contents.getURL().startsWith('voyager://extension-menu')
          )
      )
    )
    .toBe(true)

  const menuPage = (): Page | undefined =>
    voyager.app
      .windows()
      .find(
        (page) =>
          page.url().includes('extensionMenu.html') ||
          page.url().startsWith('voyager://extension-menu')
      )
  await expect.poll(() => menuPage() !== undefined).toBe(true)
  const menu = menuPage()
  expect(menu).toBeDefined()
  await expect(menu!.getByRole('heading', { name: 'Extensions' })).toBeVisible()
  await expect(menu!.getByText('Voyager E2E Password Filler')).toBeVisible()
  const icon = menu!.locator('[data-extension-row] img')
  await expect(icon).toHaveAttribute('src', /^data:image\/png;base64,/)
  expect(
    await icon.evaluate((element) => {
      const image = element as HTMLImageElement
      return image.complete && image.naturalWidth > 0
    })
  ).toBe(true)
  await expect(menu!.getByRole('button', { name: 'Pin extension' })).toBeVisible()
  await expect(
    menu!.getByRole('button', { name: 'More options for Voyager E2E Password Filler' })
  ).toBeVisible()
})

test('opens a popup when an extension row in the HTML menu is clicked', async ({
  launchVoyager
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const puzzleAnchor = await buttonAnchor(voyager, 'Extensions')
  await voyager.chrome.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Extensions'
    )
    const rect = button?.getBoundingClientRect()
    return window.voyager.extensions.showActionMenu(rect?.right ?? 0, rect?.bottom ?? 0)
  })

  const isMenuPage = (url: string): boolean =>
    url.includes('extensionMenu.html') || url.startsWith('voyager://extension-menu')
  const menuPage = (): Page | undefined =>
    voyager.app.windows().find((page) => isMenuPage(page.url()))
  await expect.poll(() => menuPage() !== undefined).toBe(true)
  const menu = menuPage()
  const row = menu!.getByRole('button', { name: 'Voyager E2E Password Filler', exact: true })
  await expect(row).toBeVisible()
  await row.click()

  await expect
    .poll(() =>
      voyager.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) => contents.getURL().startsWith('chrome-extension://'))
      )
    )
    .toBe(true)
  const popupText = await voyager.app.evaluate(({ webContents }) => {
    const popup = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('chrome-extension://'))
    return popup?.executeJavaScript(
      "document.querySelector('#voyager-extension-popup')?.textContent ?? ''"
    )
  })
  expect(popupText).toBe('password-filler-popup')

  // The popup should still appear to come from the puzzle button, not the row
  // that was clicked inside the HTML menu.
  const bounds = await panelBounds(voyager, 'chrome-extension://')
  expect(bounds).not.toBeNull()
  expect(Math.abs(bounds!.x + bounds!.width - puzzleAnchor.x)).toBeLessThan(3)
  expect(Math.abs(bounds!.y - (puzzleAnchor.y + 8))).toBeLessThan(3)
})

test('pins an extension to the toolbar and persists its site access', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string

  const pinned = await voyager.chrome.evaluate((extensionId) => {
    return window.voyager.extensions.setPinned(extensionId, true)
  }, id)
  expect(pinned[0]).toEqual(expect.objectContaining({ id, pinned: true }))
  await expect(
    voyager.chrome.getByRole('button', { name: 'Open Voyager E2E Password Filler' })
  ).toBeVisible()

  const pinAnchor = await buttonAnchor(voyager, 'Open Voyager E2E Password Filler')
  await voyager.chrome.getByRole('button', { name: 'Open Voyager E2E Password Filler' }).click()
  await expect.poll(() => panelBounds(voyager, 'chrome-extension://')).not.toBeNull()
  const popupBounds = await panelBounds(voyager, 'chrome-extension://')
  expect(popupBounds).not.toBeNull()
  expect(Math.abs(popupBounds!.x + popupBounds!.width - pinAnchor.x)).toBeLessThan(3)
  expect(Math.abs(popupBounds!.y - (pinAnchor.y + 8))).toBeLessThan(3)

  const access = await voyager.chrome.evaluate((extensionId) => {
    return window.voyager.extensions.setSiteAccess(extensionId, 'all')
  }, id)
  expect(access[0]).toEqual(expect.objectContaining({ id, siteAccess: 'all' }))
})

test('rejects Web Store URLs outside the Chrome Web Store', async ({ voyager }) => {
  await expect(
    voyager.chrome.evaluate(
      (url) => window.voyager.extensions.installFromStore(url),
      'https://example.com/detail/extension/abcdefghijklmnopabcdefghijklmnop'
    )
  ).rejects.toThrow('Only Chrome Web Store URLs are supported.')
})

test('lists installed extensions in the developer settings section', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: {
      settings: {
        developerMode: true,
        installedExtensions: [EXTENSION_PATH]
      }
    }
  })
  const settings = await openSettings(voyager)

  const section = settings.locator('[data-settings-section="extensions"]')
  await expect(section).toBeVisible()
  await expect(section).toContainText('Voyager E2E Password Filler')
  await expect(section).toContainText('Install .crx...')
  await expect(section.getByLabel('Chrome Web Store URL or extension id')).toBeVisible()
})

test('extension popups do not receive the browser management bridge', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  const bridges = await popup!.evaluate(() => ({
    voyager: typeof (globalThis as any).voyager,
    chromeRuntime: typeof (globalThis as any).chrome?.runtime
  }))
  expect(bridges.voyager).toBe('undefined')
  expect(bridges.chromeRuntime).toBe('object')
})

test('does not send webNavigation events without the declared permission', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate(async (extensionId) => {
    await window.voyager.extensions.setSiteAccess(extensionId, 'all')
    await window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.evaluate(() => {
    localStorage.setItem('webnav-count', '0')
    localStorage.removeItem('webnav-url')
    ;(globalThis as any).chrome.webNavigation.onCommitted.addListener((details: any) => {
      const count = Number(localStorage.getItem('webnav-count') ?? 0) + 1
      localStorage.setItem('webnav-count', String(count))
      localStorage.setItem('webnav-url', details.url)
    })
  })

  await voyager.navigate(server.url('/no-webnav'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/no-webnav'))
  await voyager.tab.waitForTimeout(1000)
  expect(await popup!.evaluate(() => Number(localStorage.getItem('webnav-count') ?? 0))).toBe(0)
})

test('sends webNavigation events only for sites granted to the extension', async ({
  launchVoyager,
  server
}) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [WEB_NAVIGATION_EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  expect(id).toBeTruthy()
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.evaluate(() => {
    localStorage.setItem('webnav-count', '0')
    localStorage.removeItem('webnav-url')
    ;(globalThis as any).chrome.webNavigation.onCommitted.addListener((details: any) => {
      const count = Number(localStorage.getItem('webnav-count') ?? 0) + 1
      localStorage.setItem('webnav-count', String(count))
      localStorage.setItem('webnav-url', details.url)
    })
  })

  const site = new URL(server.url('/home')).hostname
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))
  await voyager.tab.waitForTimeout(1000)
  expect(await popup!.evaluate(() => Number(localStorage.getItem('webnav-count') ?? 0))).toBe(0)

  const access = await voyager.chrome.evaluate(
    ({ extensionId, siteKey }) =>
      window.voyager.extensions.setSiteAccess(extensionId, 'site', siteKey),
    { extensionId: id, siteKey: site }
  )
  expect(access[0]).toEqual(expect.objectContaining({ id, siteAccess: 'site' }))
  await popup!.evaluate(() => {
    localStorage.setItem('webnav-count', '0')
    localStorage.removeItem('webnav-url')
  })
  await voyager.navigate(server.url('/home?granted=1'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home?granted=1'))
  await expect
    .poll(() => popup!.evaluate(() => localStorage.getItem('webnav-url')))
    .toBe(server.url('/home?granted=1'))
  expect(
    await popup!.evaluate(() => Number(localStorage.getItem('webnav-count') ?? 0))
  ).toBeGreaterThan(0)
})

test('re-prompts a blocked optional permission on the next request', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  const requestPermission = () =>
    popup!.evaluate(async () =>
      (globalThis as any).chrome.permissions.request({ permissions: ['privacy'] })
    )

  const first = requestPermission()
  const firstPrompt = voyager.chrome.getByRole('dialog')
  await expect(firstPrompt).toBeVisible()
  await firstPrompt.getByRole('button', { name: 'Never allow' }).click()
  expect(await first).toBe(false)
  await expect(firstPrompt).toHaveCount(0)

  const contains = await popup!.evaluate(() =>
    (globalThis as any).chrome.permissions.contains({ permissions: ['privacy'] })
  )
  expect(contains).toBe(false)

  // A combined request must include the blocked permission again rather than
  // silently treating it as granted because another key is still pending.
  const combined = popup!.evaluate(async () =>
    (globalThis as any).chrome.permissions.request({ permissions: ['privacy', 'tabs'] })
  )
  const combinedPrompt = voyager.chrome.getByRole('dialog')
  await expect(combinedPrompt).toBeVisible()
  await expect(combinedPrompt).toContainText('Change your privacy-related settings')
  await expect(combinedPrompt).toContainText('See your browsing tabs and activity')
  await combinedPrompt.getByRole('button', { name: 'Allow', exact: true }).click()
  expect(await combined).toBe(true)
  await expect(combinedPrompt).toHaveCount(0)

  const containsAfter = await popup!.evaluate(() =>
    (globalThis as any).chrome.permissions.contains({ permissions: ['privacy'] })
  )
  expect(containsAfter).toBe(true)
})

test('requests a host permission declared in an MV3 manifest', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  const request = popup!.evaluate(async () =>
    (globalThis as any).chrome.permissions.request({ origins: ['https://example.test/*'] })
  )
  const prompt = voyager.chrome.getByRole('dialog')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Allow', exact: true }).click()
  expect(await request).toBe(true)

  const contains = await popup!.evaluate(() =>
    (globalThis as any).chrome.permissions.contains({ origins: ['https://example.test/*'] })
  )
  expect(contains).toBe(true)
})

test('accepts a wildcard native messaging origin', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  await voyager.chrome.evaluate((hostPath) => {
    window.voyager.extensions.setNativeHosts([
      { name: 'com.voyager.e2e', path: hostPath, allowedOrigins: ['*/'] }
    ])
  }, NATIVE_HOST_PATH)
  await voyager.chrome.evaluate((extensionId) => {
    void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
  }, id)

  await expect
    .poll(() => voyager.app.windows().some((page) => page.url().startsWith('chrome-extension://')))
    .toBe(true)
  const popup = voyager.app.windows().find((page) => page.url().startsWith('chrome-extension://'))
  await popup!.getByRole('button', { name: 'Send native message' }).click()
  await expect(popup!.locator('#native-result')).toHaveText('one-shot')
})

test('reopens an action popup after Escape dismisses it', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({
    seed: { settings: { installedExtensions: [EXTENSION_PATH] } }
  })
  const extensions = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
  const id = extensions[0]?.id as string
  const open = () =>
    voyager.chrome.evaluate((extensionId) => {
      void window.voyager.extensions.openPopup(extensionId, 'popup.html', 100, 100)
    }, id)
  // Playwright retains Page handles for destroyed WebContentsViews, so ask the
  // main process which extension documents are actually still alive.
  const popupOpen = () =>
    voyager.app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .some(
          (contents) =>
            !contents.isDestroyed() && contents.getURL().startsWith('chrome-extension://')
        )
    )
  await open()
  await expect.poll(async () => Boolean(await liveExtensionPage(voyager.app))).toBe(true)
  await pollUntil(async () => {
    if (!(await popupOpen())) return true
    const popup = await liveExtensionPage(voyager.app)
    if (!popup) return undefined
    try {
      await popup.bringToFront()
      await popup.keyboard.press('Escape')
    } catch {
      // Dismissing the panel can close the target while Playwright is still
      // dispatching the key; the popup state below decides whether it worked.
    }
    return (await popupOpen()) ? undefined : true
  })
  await expect.poll(popupOpen).toBe(false)

  await open()
  await expect.poll(popupOpen).toBe(true)
})

test('service workers only create tabs in their own profile', async ({ launchVoyager }) => {
  const voyager = await launchVoyager({ args: ['--enable-sandbox'] })
  const profileB = await voyager.chrome.evaluate(() =>
    window.voyager.profiles.create({ name: 'Worker profile' })
  )
  await voyager.chrome.evaluate((id) => window.voyager.profiles.openWindow(id), profileB.id)
  // Window count can become two before the second chrome renderer has loaded;
  // wait for the actual page we are about to drive.
  const profileBChrome = await pollUntil(() =>
    voyager.app
      .windows()
      .find(
        (page) => page !== voyager.chrome && /\/renderer\/index\.html(?:[?#]|$)/.test(page.url())
      )
  )
  await profileBChrome.bringToFront()
  await profileBChrome.evaluate(
    (path) => window.voyager.extensions.install(path),
    WORKER_EXTENSION_PATH
  )
  await voyager.chrome.bringToFront()

  const workerTab = (page: Page) =>
    page.evaluate(async () => {
      const state = await window.voyager.tabs.getState()
      return state.tabs.some((tab) => tab.url.endsWith('/probe.html'))
    })
  await expect.poll(() => workerTab(profileBChrome)).toBe(true)
  expect(await workerTab(voyager.chrome)).toBe(false)
})
