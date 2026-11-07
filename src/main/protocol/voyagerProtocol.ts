import { join } from 'node:path'
import type { Protocol, Session } from 'electron'

function handleVoyagerRequest(
  request: { url: string },
  callback: (response: string | Electron.ProtocolResponse) => void
): void {
  // Start/settings pages carry query strings or hashes that must not become
  // part of the file path.
  const url = request.url.replace('voyager://', '').split(/[?#]/, 1)[0]
  if (url === 'start' || url === 'start/') {
    callback({ path: join(__dirname, '../renderer/', 'start.html') })
    return
  }
  if (url.startsWith('start/')) {
    const relative = url.substring('start/'.length)
    callback({ path: join(__dirname, '../renderer/', relative) })
    return
  }
  if (url === 'settings' || url === 'settings/') {
    callback({ path: join(__dirname, '../renderer/', 'settings.html') })
    return
  }
  if (url.startsWith('settings/')) {
    const relative = url.substring('settings/'.length)
    callback({ path: join(__dirname, '../renderer/', relative) })
    return
  }
  if (url.startsWith('assets/')) {
    callback({ path: join(__dirname, '../renderer/assets/', url.substring('assets/'.length)) })
    return
  }
  if (url === '' || url === '/') {
    callback({ path: join(__dirname, '../renderer/', 'index.html') })
    return
  }
  callback({ path: join(__dirname, '../renderer/', url) })
}

/** Serve the bundled voyager:// renderer pages and assets for a session. */
export function registerVoyagerProtocol(target: Protocol | Session['protocol']): void {
  target.registerFileProtocol('voyager', handleVoyagerRequest)
}
