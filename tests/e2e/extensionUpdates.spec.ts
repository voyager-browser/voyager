import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { verifyCrx3Signature } from '../../src/main/extensions/crxSignature'
import {
  EXTENSION_UPDATE_INTERVAL_MS,
  parseExtensionUpdateManifest
} from '../../src/main/extensions/updateManifest'
import { expect, test } from './fixtures'
import {
  createTestCrxSigner,
  extensionCrx,
  signedExtensionCrx,
  storedZip,
  testCrxSigner,
  type TestCrxSigner
} from './helpers/crx'
import { createTestTls } from './helpers/tls'
import { waitForJson } from './helpers/voyager'

interface UpdateServer {
  readonly baseUrl: string
  readonly httpBaseUrl: string
  readonly env: Record<string, string>
  readonly requests: string[]
  setPackage(
    version: string,
    crx: Buffer,
    format?: { standard?: boolean; httpCodebase?: boolean }
  ): void
  close(): Promise<void>
}

function updateXml(
  baseUrl: string,
  httpBaseUrl: string,
  version: string,
  crx: Buffer,
  standard: boolean,
  httpCodebase: boolean
): string {
  const hash = createHash('sha256').update(crx).digest('hex')
  const root = httpCodebase ? httpBaseUrl : baseUrl
  const header =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">' +
    '<app appid="update-test">'
  if (standard) {
    return (
      header +
      `<updatecheck status="ok" version="${version}" codebase="${root}/extension.crx" hash_sha256="${hash}" />` +
      '</app></gupdate>'
    )
  }
  return (
    header +
    '<updatecheck status="ok">' +
    `<urls><url codebase="${root}/" /></urls>` +
    `<manifest version="${version}"><packages>` +
    `<package name="extension.crx" hash_sha256="${hash}" />` +
    '</packages></manifest></updatecheck></app></gupdate>'
  )
}

async function startUpdateServer(): Promise<UpdateServer> {
  let version = '1.0.0'
  let crx: Buffer = Buffer.alloc(0)
  let standard = false
  let httpCodebase = false
  let baseUrl = ''
  let httpBaseUrl = ''
  const requests: string[] = []
  const tls = createTestTls()

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    requests.push(path)
    if (path === '/update.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end(updateXml(baseUrl, httpBaseUrl, version, crx, standard, httpCodebase))
      return
    }
    if (path === '/extension.crx') {
      response.writeHead(200, { 'content-type': 'application/x-chrome-extension' })
      response.end(crx)
      return
    }
    response.writeHead(404)
    response.end()
  }

  const httpsServer = createHttpsServer(tls.credentials, handler)
  const httpServer = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    httpsServer.once('error', reject)
    httpsServer.listen(0, '127.0.0.1', () => resolve())
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })
  const address = httpsServer.address() as AddressInfo
  const httpAddress = httpServer.address() as AddressInfo
  baseUrl = `https://127.0.0.1:${address.port}`
  httpBaseUrl = `http://127.0.0.1:${httpAddress.port}`

  const closeServer = (server: {
    closeAllConnections?: () => void
    close(callback: (error?: Error) => void): unknown
  }): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.()
      server.close((error?: Error) => (error ? reject(error) : resolve()))
    })

  return {
    baseUrl,
    httpBaseUrl,
    env: tls.env,
    requests,
    setPackage(nextVersion, nextCrx, format) {
      version = nextVersion
      crx = nextCrx
      standard = format?.standard ?? false
      httpCodebase = format?.httpCodebase ?? false
    },
    async close() {
      await Promise.all([closeServer(httpsServer), closeServer(httpServer)])
      tls.close()
    }
  }
}

/** Seed a downloaded extension the same way a signed CRX install would. */
function seedInstalledExtension(
  userDataDir: string,
  version: string,
  updateUrl: string,
  signer: TestCrxSigner,
  withIdentity = true
) {
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
      extensionUpdateInfo: {
        [path]: {
          updateUrl,
          version,
          lastCheckedAt: 0,
          ...(withIdentity
            ? { publicKeyHash: signer.publicKeyHash, signingId: signer.extensionId }
            : {})
        }
      }
    }
  }
}

function testManifest(version: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'Update Test Extension',
    version,
    description: 'Verifies automatic extension updates.'
  }
}

function testCrx(version: string, signer: TestCrxSigner): Buffer {
  return signedExtensionCrx(testManifest(version), signer)
}

function tamperedCrx(crx: Buffer): Buffer {
  const tampered = Buffer.from(crx)
  tampered[tampered.length - 5] ^= 0xff
  return tampered
}

test('parses nested and standard Chrome update manifests', () => {
  const nested = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">',
    '<app appid="abcdefghijklmnop"><updatecheck status="ok">',
    '<urls><url codebase="https://example.test/extensions/" /></urls>',
    '<manifest version="2.1.0"><packages>',
    '<package name="extension.crx" hash_sha256="abc123" />',
    '</packages></manifest></updatecheck></app></gupdate>'
  ].join('')

  expect(parseExtensionUpdateManifest(nested)).toEqual({
    version: '2.1.0',
    crxUrl: 'https://example.test/extensions/extension.crx',
    hashSha256: 'abc123'
  })

  const standard = [
    '<gupdate><app appid="other-app"><updatecheck status="noupdate" /></app>',
    '<app appid="abcdefghijklmnop">',
    '<updatecheck status="ok" version="3.0.0" codebase="extension.crx" hash_sha256="def456" />',
    '</app></gupdate>'
  ].join('')
  expect(
    parseExtensionUpdateManifest(
      standard,
      'https://example.test/extensions/update.xml',
      'abcdefghijklmnop'
    )
  ).toEqual({
    version: '3.0.0',
    crxUrl: 'https://example.test/extensions/extension.crx',
    hashSha256: 'def456'
  })

  expect(parseExtensionUpdateManifest('<updatecheck status="noupdate" />')).toEqual({
    version: '',
    crxUrl: '',
    noUpdate: true
  })
  expect(() =>
    parseExtensionUpdateManifest(
      '<updatecheck status="ok" version="3.0.0" codebase="http://example.test/extension.crx" />'
    )
  ).toThrow(/HTTPS/)
  expect(EXTENSION_UPDATE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
})

test('verifies CRX3 signatures and derives the signing identity', () => {
  const signer = createTestCrxSigner()
  const zip = storedZip([{ name: 'manifest.json', content: Buffer.from('{}') }])
  const crx = signer.sign(zip)

  expect(verifyCrx3Signature(crx, signer.extensionId)).toEqual({
    publicKeyHash: signer.publicKeyHash,
    extensionId: signer.extensionId,
    signedId: signer.publicKeyHash.slice(0, 32)
  })

  const tampered = Buffer.from(crx)
  tampered[tampered.length - 5] ^= 0xff
  expect(() => verifyCrx3Signature(tampered, signer.extensionId)).toThrow(/signature/)
  expect(() => verifyCrx3Signature(signer.sign(zip, { crxId: 'b'.repeat(32) }))).toThrow(
    /signed extension id/
  )
  expect(() => verifyCrx3Signature(crx, 'a'.repeat(32))).toThrow(/different developer/)
})

test('records the verified CRX3 identity when installing a signed CRX', async ({
  voyager,
  downloadDir,
  userDataDir
}) => {
  const signer = testCrxSigner()
  const crxPath = join(downloadDir, 'signed.crx')
  writeFileSync(
    crxPath,
    signedExtensionCrx(
      {
        ...testManifest('1.0.0'),
        update_url: 'https://example.test/update.xml'
      },
      signer
    )
  )

  await voyager.chrome.evaluate((path) => window.voyager.extensions.install(path), crxPath)
  const stored = await waitForJson<{ extensionUpdateInfo: Record<string, unknown> }>(
    join(userDataDir, 'settings.json'),
    (value) => Object.keys(value.extensionUpdateInfo ?? {}).length > 0
  )
  expect(Object.values(stored.extensionUpdateInfo)[0]).toEqual(
    expect.objectContaining({
      publicKeyHash: signer.publicKeyHash,
      signingId: signer.extensionId
    })
  )
})

test('manual update check installs a newer signed CRX over HTTPS', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  const signer = testCrxSigner()
  try {
    const seed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.baseUrl}/update.xml`,
      signer
    )
    server.setPackage('1.0.0', testCrx('1.0.0', signer), { standard: true })
    const voyager = await launchVoyager({
      seed: { settings: seed.settings },
      env: server.env
    })

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
        server.setPackage('2.0.0', testCrx('2.0.0', signer), { standard: true })
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

test('browser startup checks for and applies signed extension updates', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  const signer = testCrxSigner()
  try {
    const seed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.baseUrl}/update.xml`,
      signer
    )
    server.setPackage('1.0.0', testCrx('1.0.0', signer))

    const first = await launchVoyager({
      seed: { settings: seed.settings },
      env: server.env
    })
    await expect
      .poll(
        async () =>
          (await first.chrome.evaluate(() => window.voyager.extensions.getState()))[0]?.version
      )
      .toBe('1.0.0')
    await first.close()

    server.setPackage('2.0.0', testCrx('2.0.0', signer))
    const second = await launchVoyager({ env: server.env })
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

test('rejects plain HTTP update URLs and HTTP codebases', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  const signer = testCrxSigner()
  try {
    const seed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.httpBaseUrl}/update.xml`,
      signer
    )
    server.setPackage('2.0.0', testCrx('2.0.0', signer))
    const voyager = await launchVoyager({
      seed: { settings: seed.settings },
      env: server.env
    })

    const insecureUrl = await voyager.chrome.evaluate(() =>
      window.voyager.extensions.checkUpdates()
    )
    expect(insecureUrl[0]).toEqual(
      expect.objectContaining({ status: 'failed', message: expect.stringMatching(/HTTPS/) })
    )

    const httpsSeed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.baseUrl}/update.xml`,
      signer
    )
    server.setPackage('2.0.0', testCrx('2.0.0', signer), { httpCodebase: true })
    await voyager.close()
    const httpsVoyager = await launchVoyager({
      seed: { settings: httpsSeed.settings },
      env: server.env
    })
    const httpCodebase = await httpsVoyager.chrome.evaluate(() =>
      window.voyager.extensions.checkUpdates()
    )
    expect(httpCodebase[0]).toEqual(
      expect.objectContaining({ status: 'failed', message: expect.stringMatching(/HTTPS/) })
    )
  } finally {
    await server.close()
  }
})

test('rejects tampered, wrong-identity and unsigned automatic updates', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  const signer = testCrxSigner()
  try {
    const seed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.baseUrl}/update.xml`,
      signer
    )
    server.setPackage('1.0.0', testCrx('1.0.0', signer))
    const voyager = await launchVoyager({
      seed: { settings: seed.settings },
      env: server.env
    })

    const attempt = async (crx: Buffer): Promise<string> => {
      server.setPackage('2.0.0', crx)
      const results = await voyager.chrome.evaluate(() => window.voyager.extensions.checkUpdates())
      return results[0]?.message ?? ''
    }

    expect(await attempt(tamperedCrx(testCrx('2.0.0', signer)))).toMatch(/signature/)
    expect(await attempt(testCrx('2.0.0', createTestCrxSigner()))).toMatch(/different developer/)
    expect(
      await attempt(
        extensionCrx({
          manifest_version: 3,
          name: 'Update Test Extension',
          version: '2.0.0'
        })
      )
    ).toMatch(/signed CRX3/)

    const state = await voyager.chrome.evaluate(() => window.voyager.extensions.getState())
    expect(state[0]).toEqual(expect.objectContaining({ version: '1.0.0', loaded: true }))
  } finally {
    await server.close()
  }
})

test('rejects automatic updates without a persisted signing identity', async ({
  launchVoyager,
  userDataDir
}) => {
  const server = await startUpdateServer()
  const signer = testCrxSigner()
  try {
    const seed = seedInstalledExtension(
      userDataDir,
      '1.0.0',
      `${server.baseUrl}/update.xml`,
      signer,
      false
    )
    server.setPackage('2.0.0', testCrx('2.0.0', signer))
    const voyager = await launchVoyager({
      seed: { settings: seed.settings },
      env: server.env
    })
    const results = await voyager.chrome.evaluate(() => window.voyager.extensions.checkUpdates())
    expect(results[0]?.message).toMatch(/no verified signing identity/)
  } finally {
    await server.close()
  }
})
