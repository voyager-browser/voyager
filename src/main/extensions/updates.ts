/**
 * Automatic extension updates. Downloaded CRX and Web Store extensions are
 * checked once at browser start and then every six hours. Unpacked folders the
 * user selected are left alone because Voyager does not own their contents.
 */

import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IpcChannels } from '../../shared/ipc-channels'
import type { ExtensionUpdateResult } from '../../shared/types'
import { broadcastToProfile, ensureProfileSession, sessionForProfile } from '../profiles/session'
import { listProfiles } from '../profiles/profiles'
import { downloadCrx, unpackCrx } from './crx'
import {
  attachExtensions,
  currentExtensionsState,
  installedExtensionPaths,
  replaceInstalledExtensionFiles
} from './extensions'
import {
  compareExtensionVersions,
  EXTENSION_UPDATE_INTERVAL_MS,
  parseExtensionUpdateManifest
} from './updateManifest'
import {
  recordExtensionUpdateInfo,
  updateInfoForPath,
  type ExtensionUpdateInfo
} from './updateMetadata'

const UPDATE_SERVICE = 'https://clients2.google.com/service/update2/crx'
const REQUEST_TIMEOUT_MS = 30_000

function updateUrlFor(info: ExtensionUpdateInfo): string | null {
  if (info.storeId) {
    const params = new URLSearchParams({
      response: 'updatecheck',
      prod: 'chromecrx',
      prodversion: process.versions.chrome || '141.0.0.0',
      acceptformat: 'crx2,crx3',
      x: `id=${info.storeId}&installsource=ondemand&uc`
    })
    return `${UPDATE_SERVICE}?${params.toString()}`
  }
  if (!info.updateUrl) return null
  try {
    const url = new URL(info.updateUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function installedVersion(path: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'))
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('The extension update has no valid version.')
  }
  return (parsed as { version: string }).version
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The extension update failed.'
}

async function runProfileExtensionUpdateCheck(profileId: string): Promise<ExtensionUpdateResult[]> {
  const ses = sessionForProfile(profileId)
  await attachExtensions(ses, profileId)
  const loaded = new Map(
    currentExtensionsState(ses, profileId).map((item) => [resolve(item.path), item])
  )
  const results: ExtensionUpdateResult[] = []

  for (const path of installedExtensionPaths(profileId)) {
    const info = updateInfoForPath(profileId, path)
    const current = loaded.get(resolve(path))
    const name = current?.name ?? path
    const fromVersion = info?.version || current?.version || ''
    if (!info || (!info.storeId && !info.updateUrl)) {
      results.push({ name, fromVersion, status: 'skipped' })
      continue
    }
    const updateUrl = updateUrlFor(info)
    if (!updateUrl) {
      results.push({ name, fromVersion, status: 'failed', message: 'The update URL is invalid.' })
      continue
    }

    recordExtensionUpdateInfo(profileId, path, { version: fromVersion, lastCheckedAt: Date.now() })
    try {
      const response = await fetch(updateUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok)
        throw new Error(`The extension update service returned HTTP ${response.status}.`)
      const update = parseExtensionUpdateManifest(await response.text(), updateUrl)
      if (update.noUpdate) {
        results.push({ name, fromVersion, status: 'up-to-date' })
        continue
      }
      if (compareExtensionVersions(update.version, fromVersion) <= 0) {
        results.push({ name, fromVersion, status: 'up-to-date', toVersion: update.version })
        continue
      }

      const crxPath = await downloadCrx(update.crxUrl, update.hashSha256)
      let unpackedPath: string | null = null
      try {
        unpackedPath = unpackCrx(crxPath, profileId)
        const newVersion = installedVersion(unpackedPath)
        if (compareExtensionVersions(newVersion, fromVersion) <= 0) {
          results.push({ name, fromVersion, status: 'up-to-date', toVersion: newVersion })
          continue
        }
        await replaceInstalledExtensionFiles(ses, profileId, path, unpackedPath)
        recordExtensionUpdateInfo(profileId, path, {
          version: newVersion,
          lastCheckedAt: Date.now()
        })
        results.push({ name, fromVersion, toVersion: newVersion, status: 'updated' })
      } finally {
        if (unpackedPath) rmSync(unpackedPath, { recursive: true, force: true })
        rmSync(crxPath, { force: true })
      }
    } catch (error) {
      results.push({ name, fromVersion, status: 'failed', message: failureMessage(error) })
    }
  }

  broadcastToProfile(
    profileId,
    IpcChannels.ExtensionsStateChanged,
    currentExtensionsState(ses, profileId)
  )
  return results
}

/** Concurrent checks for one profile share the same in-flight pass. */
const activeProfileChecks = new Map<string, Promise<ExtensionUpdateResult[]>>()

export function checkProfileExtensionUpdates(profileId: string): Promise<ExtensionUpdateResult[]> {
  const pending = activeProfileChecks.get(profileId)
  if (pending) return pending
  const task = runProfileExtensionUpdateCheck(profileId).finally(() => {
    activeProfileChecks.delete(profileId)
  })
  activeProfileChecks.set(profileId, task)
  return task
}

/** Check every profile. Concurrent callers share one in-flight pass. */
let activeCheck: Promise<ExtensionUpdateResult[]> | null = null

export function checkAllExtensionUpdates(): Promise<ExtensionUpdateResult[]> {
  if (activeCheck) return activeCheck
  const task = (async (): Promise<ExtensionUpdateResult[]> => {
    const results: ExtensionUpdateResult[] = []
    for (const profile of listProfiles()) {
      try {
        const ses = ensureProfileSession(profile.id)
        await attachExtensions(ses, profile.id)
        results.push(...(await checkProfileExtensionUpdates(profile.id)))
      } catch (error) {
        results.push({
          name: profile.name,
          fromVersion: '',
          status: 'failed',
          message: failureMessage(error)
        })
      }
    }
    return results
  })().finally(() => {
    activeCheck = null
  })
  activeCheck = task
  return task
}

let updateTimer: ReturnType<typeof setInterval> | null = null

/** Check immediately on browser start, then every six hours. */
export function startExtensionUpdateScheduler(): void {
  if (updateTimer) return
  void checkAllExtensionUpdates().catch(() => undefined)
  updateTimer = setInterval(() => {
    void checkAllExtensionUpdates().catch(() => undefined)
  }, EXTENSION_UPDATE_INTERVAL_MS)
  updateTimer.unref?.()
}

export function stopExtensionUpdateScheduler(): void {
  if (!updateTimer) return
  clearInterval(updateTimer)
  updateTimer = null
}
