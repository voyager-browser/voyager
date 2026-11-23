import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, type Protocol, type Session } from 'electron'
import { profileDataDir } from '../store'

const SAFE_PROFILE = /^[A-Za-z0-9_-]+$/
const SAFE_ASSET = /^[A-Za-z0-9._-]+$/

function resolveRendererPath(relativePath: string): string {
  const candidates = [
    join(__dirname, '../renderer', relativePath),
    join(app.getAppPath(), 'out/renderer', relativePath),
    join(process.cwd(), 'out/renderer', relativePath)
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function handleVoyagerRequest(
  request: { url: string },
  callback: (response: string | Electron.ProtocolResponse) => void
): void {
  // Start/settings pages carry query strings or hashes that must not become
  // part of the file path.
  const url = request.url.replace('voyager://', '').split(/[?#]/, 1)[0]
  if (url.startsWith('theme/')) {
    const [rawProfile = '', rawFile = ''] = url.slice('theme/'.length).split('/')
    let profile: string
    let file: string
    try {
      profile = decodeURIComponent(rawProfile)
      file = decodeURIComponent(rawFile)
    } catch {
      callback({ statusCode: 400 })
      return
    }
    if (
      !SAFE_PROFILE.test(profile) ||
      !SAFE_ASSET.test(file) ||
      file.includes('..') ||
      !existsSync(join(profileDataDir(profile), 'theme', file))
    ) {
      callback({ statusCode: 404 })
      return
    }
    callback({
      path: join(profileDataDir(profile), 'theme', file),
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
    return
  }
  if (url === 'start' || url === 'start/') {
    callback({ path: resolveRendererPath('start.html') })
    return
  }
  if (url.startsWith('start/')) {
    const relative = url.substring('start/'.length)
    callback({ path: resolveRendererPath(relative) })
    return
  }
  if (url === 'settings' || url === 'settings/') {
    callback({ path: resolveRendererPath('settings.html') })
    return
  }
  if (url.startsWith('settings/')) {
    const relative = url.substring('settings/'.length)
    callback({ path: resolveRendererPath(relative) })
    return
  }
  if (url.startsWith('assets/')) {
    callback({ path: resolveRendererPath(join('assets', url.substring('assets/'.length))) })
    return
  }
  if (url === '' || url === '/') {
    callback({ path: resolveRendererPath('index.html') })
    return
  }
  callback({ path: resolveRendererPath(url) })
}

/** Serve the bundled voyager:// renderer pages and assets for a session. */
export function registerVoyagerProtocol(target: Protocol | Session['protocol']): void {
  target.registerFileProtocol('voyager', handleVoyagerRequest)
}
