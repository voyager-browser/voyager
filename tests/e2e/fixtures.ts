import { test as base, type TestInfo } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestServer, type TestServer } from './helpers/server'
import { createAppRegistry, launchVoyager, type VoyagerApp } from './helpers/voyager'

const capturedApps = new WeakSet<VoyagerApp>()

/**
 * Electron windows are not part of Playwright's automatic screenshot recorder,
 * so attach their screenshots explicitly for UI mode and HTML reports.
 */
export async function attachWindowScreenshots(
  voyager: VoyagerApp,
  testInfo: TestInfo
): Promise<void> {
  if (capturedApps.has(voyager)) return
  capturedApps.add(voyager)

  const pages = voyager
    .pages()
    .filter((page) => !page.isClosed() && !page.url().startsWith('devtools://'))
  for (const [index, page] of pages.entries()) {
    try {
      const body = await page.screenshot({ timeout: 5_000 })
      await testInfo.attach(index === 0 ? 'screenshot' : `screenshot-${index + 1}`, {
        body,
        contentType: 'image/png'
      })
    } catch {
      // A window can close mid-capture; keep screenshots of the other windows.
    }
  }
}

interface LaunchOverrides {
  userDataDir?: string
  seed?: Record<string, unknown>
  args?: string[]
  env?: Record<string, string>
}

interface Fixtures {
  userDataDir: string
  downloadDir: string
  server: TestServer
  launchVoyager: (overrides?: LaunchOverrides) => Promise<VoyagerApp>
  voyager: VoyagerApp
}

export const test = base.extend<Fixtures>({
  userDataDir: async ({}, provide) => {
    const directory = mkdtempSync(join(tmpdir(), 'voyager-e2e-'))
    await provide(directory)
    rmSync(directory, { recursive: true, force: true })
  },

  downloadDir: async ({}, provide) => {
    const directory = mkdtempSync(join(tmpdir(), 'voyager-downloads-'))
    await provide(directory)
    rmSync(directory, { recursive: true, force: true })
  },

  server: async ({}, provide) => {
    const server = await startTestServer()
    await provide(server)
    await server.close()
  },

  launchVoyager: async ({ userDataDir, downloadDir }, provide, testInfo) => {
    const launched: VoyagerApp[] = []
    const apps = createAppRegistry()
    const launch = async (overrides: LaunchOverrides = {}): Promise<VoyagerApp> => {
      const voyager = await launchVoyager({
        userDataDir: overrides.userDataDir ?? userDataDir,
        downloadDir,
        seed: overrides.seed,
        args: overrides.args,
        env: overrides.env,
        // Register the raw app before setup can fail so teardown still sees it.
        onApp: (app) => apps.register(app)
      })
      const close = voyager.close
      voyager.close = async () => {
        await attachWindowScreenshots(voyager, testInfo)
        await close()
      }
      launched.push(voyager)
      return voyager
    }
    await provide(launch)
    for (const voyager of launched) await voyager.close()
    // Apps registered before a failed setup never became VoyagerApps.
    await apps.closeAll()
  },

  voyager: async ({ launchVoyager }, provide) => {
    const voyager = await launchVoyager()
    await provide(voyager)
    await voyager.close()
  }
})

export { expect } from '@playwright/test'
