import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppRegistry, launchVoyager } from './helpers/voyager'

test('closes and registers a raw app when setup fails after launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'voyager-launch-cleanup-'))
  const originalLaunch = electron.launch
  const stubLaunch = electron as unknown as { launch: typeof electron.launch }
  let closeCalls = 0
  let registered: ElectronApplication | undefined
  const app = {
    evaluate: async () => {
      throw new Error('clipboard setup failed')
    },
    close: async () => {
      closeCalls += 1
    }
  } as unknown as ElectronApplication
  const registry = createAppRegistry()

  // Fake the spawn so this regression never starts a real Electron process.
  stubLaunch.launch = (async () => app) as typeof electron.launch
  try {
    await expect(
      launchVoyager({
        userDataDir: join(root, 'profile'),
        downloadDir: join(root, 'downloads'),
        onApp: (candidate) => {
          registered = candidate
          registry.register(candidate)
        }
      })
    ).rejects.toThrow('clipboard setup failed')

    expect(registered).toBe(app)
    expect(closeCalls).toBe(1)

    // Teardown can still see the app registered before setup completed; the
    // second close attempt must not spawn or kill another process.
    await registry.closeAll()
    expect(closeCalls).toBe(1)
  } finally {
    stubLaunch.launch = originalLaunch
    rmSync(root, { recursive: true, force: true })
  }
})
