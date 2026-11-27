import { randomUUID } from 'node:crypto'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  ExtensionInstallChoice,
  ExtensionInstallDetails,
  ExtensionInstallRequest
} from '../../shared/types'
import type { WindowController } from '../window/WindowController'

interface PendingInstall {
  id: string
  window: WindowController
  onDestroyed: () => void
  resolve: (approved: boolean) => void
}

const pending = new Map<string, PendingInstall>()

/**
 * Chrome shows install consent on a browser window, not in Settings. Route the
 * prompt to a window in the target profile and keep the install promise open
 * until the user chooses.
 */
export function requestExtensionInstallConfirmation(
  window: WindowController,
  details: ExtensionInstallDetails
): Promise<boolean> {
  const id = randomUUID()
  const request: ExtensionInstallRequest = { ...details, id }
  return new Promise((resolve) => {
    const entry: PendingInstall = {
      id,
      window,
      onDestroyed: () => cancelExtensionInstall(id),
      resolve
    }
    pending.set(id, entry)
    window.onDestroyed(entry.onDestroyed)
    window.window.focus()
    window.focusChrome()
    window.sendToChrome(IpcChannels.ExtensionInstallRequest, request)
  })
}

function settle(id: string, approved: boolean): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  if (!entry.window.window.isDestroyed()) {
    entry.window.window.removeListener('closed', entry.onDestroyed)
  }
  entry.resolve(approved)
  return true
}

export function respondToExtensionInstall(id: string, choice: ExtensionInstallChoice): boolean {
  return settle(id, choice === 'install')
}

export function cancelExtensionInstall(id: string): void {
  settle(id, false)
}

/** Resolve any install prompts still open while the app is quitting. */
export function cancelAllExtensionInstalls(): void {
  for (const id of [...pending.keys()]) cancelExtensionInstall(id)
}
