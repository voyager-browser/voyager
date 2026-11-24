import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import {
  EXTENSION_UPDATE_INTERVAL_MS,
  parseExtensionUpdateManifest
} from '../../src/main/extensions/updateManifest'
import { expect, test } from './fixtures'
import { extensionCrx } from './helpers/crx'

interface UpdateServer {
  readonly baseUrl: string
  readonly requests: string[]
  setPackage(version: string, crx: Buffer): void
  close(): Promise<void>
}

async function startUpdateServer(): Promise<UpdateServer> {
  let version = '1.0.0'
  let crx: Buffer = Buffer.alloc(0)
  let baseUrl = ''
  const requests: string[] = []
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    requests.push(path)
    if (path === '/update.xml') {
      const hash = createHash('sha256').update(crx).digest('hex')
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">' +
          '<app appid="update-test"><updatecheck status="ok">' +
          `<urls><url codebase="${baseUrl}/" /></urls>` +
          `<manifest version="${version}"><packages>` +
          `<package name="extension.crx" hash_sha256="${hash}" />` +
          '</packages></manifest></updatecheck></app></gupdate>'
      )
      return
    }
    if (path === '/extension.crx') {
      response.writeHead(200, { 'content-type': 'application/x-chrome-extension' })
      response.end(crx)
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    requests,
    setPackage(nextVersion, nextCrx) {
      version = nextVersion
      crx = nextCrx
    },
    async close() {
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}

/** Seed a downloaded extension the same way a prior CRX install would. */
function seedInstalledExtension(userDataDir: string, version: string, updateUrl: string) {
  const path = join(userDataDir, 'unpacked-extensions', 'default', 'update-test-extension')
  mkdirSync(path, { recursive: true })
  writeFileSync(
    join(path, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Update Test Extension',
      version,
      description: 'Verifies automatic extension updates.'
    })
  )
  return {
    path,
    settings: {
      installedExtensions: [path],
      extensionUpdateInfo: { [path]: { updateUrl, version, lastCheckedAt: 0 } }
    }
  }
}

function testCrx(version: string): Buffer {
  return extensionCrx({
    manifest_version: 3,
    name: 'Update Test Extension',
    version,
    description: 'Verifies automatic extension updates.'
  })
}

test('parses Chrome update manifests and checks every six hours', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">',
    '<app appid="abcdefghijklmnop"><updatecheck status="ok">',
    '<urls><url codebase="https://example.test/extensions/" /></urls>',
    '<manifest version="2.1.0"><packages>',
    '<package name="extension.crx" hash_sha256="abc123" />',
    '</packages></manifest></updatecheck></app></gupdate>'
  ].join('')

  expect(parseExtensionUpdateManifest(xml)).toEqual({
    version: '2.1.0',
    crxUrl: 'https://example.test/extensions/extension.crx',
    hashSha256: 'abc123'
  })
  expect(parseExtensionUpdateManifest('<updatecheck status="noupdate" />')).toEqual({
    version: '',
    crxUrl: '',
    noUpdate: true
  })
  expect(EXTENSION_UPDATE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
})

test('manual update check installs a newer CRX', async ({ launchVoyager, userDataDir }) => {
  const server = await startUpdateServer()
  try {
    const seed = seedInstalledExtension(userDataDir, '1.0.0', `${server.baseUrl}/update.xml`)
    server.setPackage('1.0.0', testCrx('1.0.0'))
    const voyager = await launchVoyager({ seed: { settings: seed.settings } })

    await expect
      .poll(
        async () =>
          (await voyager.chrome.evaluate(() => window.voyager.extensions.getState()))[0]?.version
      )
      .toBe('1.0.0')

    // The startup check may still be in flight; retry until this manual pass
    // is the one that applies the new package.
    await expect
      .poll(async () => {
        server.setPackage('2.0.0', testCrx('2.0.0'))
        const results = await voyager.chrome.evaluate(() =>
          window.voyager.extensions.checkUpdates()
        )
        return results[0]?.status
      })
      .toBe('updated')

    const state = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
    expect(state[0]).toEqual(expect.objectContaining({ version: '2.0.0', loaded: true }))
    expect(server.requests).toContain('/update.xml')
    expect(server.requests).toContain('/extension.crx')
  } finally {
    await server.close()
  }
})

test('browser startup checks for and applies extension updates', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  try {
    const seed = seedInstalledExtension(userDataDir, '1.0.0', `${server.baseUrl}/update.xml`)
    server.setPackage('1.0.0', testCrx('1.0.0'))

    const first = await launchVoyager({ seed: { settings: seed.settings } })
    await expect
      .poll(
        async () =>
          (await first.chrome.evaluate(() => window.voyager.extensions.getState()))[0]?.version
      )
      .toBe('1.0.0')
    await first.close()

    server.setPackage('2.0.0', testCrx('2.0.0'))
    const second = await launchVoyager()
    await expect
      .poll(() =>
        second.chrome.evaluate(async () => {
          const state = await window.voyager.extensions.getState()
          return state[0]?.version ?? ''
        })
      )
      .toBe('2.0.0')
    expect(server.requests.filter((path) => path === '/update.xml').length).toBeGreaterThan(0)
  } finally {
    await server.close()
  }
})
