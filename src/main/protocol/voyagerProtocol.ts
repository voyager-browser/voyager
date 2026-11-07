import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, type Protocol, type Session } from 'electron'

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
