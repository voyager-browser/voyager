import { app } from 'electron'
import { execFileSync } from 'node:child_process'

/** URL schemes Voyager can own, including normal web browsing. */
export const SUPPORTED_PROTOCOLS = ['http', 'https'] as const

const LINUX_DESKTOP_FILE = 'voyager.desktop'

function linuxDefaultBrowser(): string | null {
  try {
    const result = execFileSync('xdg-settings', ['get', 'default-web-browser'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return result.trim() || null
  } catch {
    return null
  }
}

function setLinuxDefaultBrowser(): void {
  try {
    execFileSync('xdg-settings', ['set', 'default-web-browser', LINUX_DESKTOP_FILE], {
      stdio: 'ignore'
    })
    return
  } catch {
    // Fall through to xdg-mime below for minimal desktop environments.
  }
  try {
    for (const scheme of ['http', 'https']) {
      execFileSync('xdg-mime', ['default', LINUX_DESKTOP_FILE, `x-scheme-handler/${scheme}`], {
        stdio: 'ignore'
      })
    }
  } catch {
    // The desktop environment may not expose xdg tooling.
  }
}

/** Whether Voyager owns every scheme registered by {@link setDefaultBrowser}. */
function ownsSupportedProtocols(): boolean {
  return SUPPORTED_PROTOCOLS.every((scheme) => app.isDefaultProtocolClient(scheme))
}

/** Whether Voyager currently owns web links on this platform. */
export function isDefaultBrowser(): boolean {
  if (process.platform === 'linux') {
    const current = linuxDefaultBrowser()
    if (current === LINUX_DESKTOP_FILE) return true
  }
  return ownsSupportedProtocols()
}

/**
 * Ask the OS to make Voyager the default handler for web links. Some platforms
 * (notably Windows 10+) only surface a confirmation prompt, so always report
 * the state the OS actually ended up in.
 */
export async function setDefaultBrowser(): Promise<boolean> {
  if (process.platform === 'linux') {
    setLinuxDefaultBrowser()
    return isDefaultBrowser()
  }
  for (const scheme of SUPPORTED_PROTOCOLS) {
    try {
      app.setAsDefaultProtocolClient(scheme)
    } catch {
      // Keep trying the remaining schemes; some platforms reject http/https.
    }
  }
  return isDefaultBrowser()
}
