import { app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { WindowController } from '../window/WindowController'

interface IpcContext {
  getWindow(event?: IpcMainInvokeEvent): WindowController | null | undefined
}

function failureMessage(operation: 'create' | 'get', result: unknown, error?: unknown): string {
  const record = (result ?? {}) as {
    error?: unknown
    message?: unknown
    errorObject?: { message?: unknown }
  }
  const detail =
    (typeof record?.message === 'string' && record.message) ||
    (typeof record?.errorObject?.message === 'string' && record.errorObject.message) ||
    (typeof record?.error === 'string' && record.error) ||
    (error as Error | undefined)?.message ||
    String(error ?? 'unknown error')
  const devHint =
    app?.isPackaged === false
      ? ' macOS platform passkeys require a signed build carrying the com.apple.developer.web-browser.public-key-credential entitlement; `npm run dev` runs the unentitled Electron binary.'
      : ''
  return `WebAuthn ${operation} failed: ${detail}${devHint}`
}

/**
 * WebAuthn/passkey bridge. On macOS this uses the native AuthenticationServices
 * integration via electron-webauthn (platform passkeys, security keys, and
 * cross-device/hybrid QR). On other platforms the preload does not polyfill, so
 * Chromium's native WebAuthn implementation is used instead.
 */
export function registerWebAuthnHandlers(
  ipcMain: Electron.IpcMain,
  context: IpcContext
): void {
  ipcMain.handle(
    IpcChannels.WebAuthnCreate,
    async (
      event,
      payload: {
        options?: PublicKeyCredentialCreationOptions
        origin: string
        topOrigin?: string
      }
    ) => {
      if (process.platform !== 'darwin') {
        return { success: false, error: 'NotSupportedError' }
      }
      try {
        const { createCredential } = await import('electron-webauthn')
        const win = context.getWindow(event as any)?.window
        if (!win) return { success: false, error: 'NotAllowedError' }
        const options = payload?.options
        const rpId =
          options && typeof options.rp === 'object' && options.rp && 'id' in options.rp
            ? (options.rp.id as string | undefined)
            : undefined
        const result = await createCredential(options, {
          nativeWindowHandle: win.getNativeWindowHandle(),
          currentOrigin: payload?.origin ?? '',
          topFrameOrigin: payload?.topOrigin,
          ...(rpId ? { rpId } : {})
        } as any)
        if (!(result as { success?: boolean })?.success) {
          console.warn(`[voyager] ${failureMessage('create', result)}`)
        }
        return result
      } catch (err) {
        console.warn(`[voyager] ${failureMessage('create', undefined, err)}`)
        return { success: false, error: 'NotAllowedError', message: String((err as Error)?.message ?? err) }
      }
    }
  )

  ipcMain.handle(
    IpcChannels.WebAuthnGet,
    async (
      event,
      payload: {
        options?: PublicKeyCredentialRequestOptions
        origin: string
        topOrigin?: string
      }
    ) => {
      if (process.platform !== 'darwin') {
        return { success: false, error: 'NotSupportedError' }
      }
      try {
        const { getCredential } = await import('electron-webauthn')
        const win = context.getWindow(event as any)?.window
        if (!win) return { success: false, error: 'NotAllowedError' }
        const options = payload?.options
        const rpId =
          options && typeof options === 'object' && options && 'rpId' in options
            ? (options.rpId as string | undefined)
            : undefined
        const result = await getCredential(options, {
          nativeWindowHandle: win.getNativeWindowHandle(),
          currentOrigin: payload?.origin ?? '',
          topFrameOrigin: payload?.topOrigin,
          ...(rpId ? { rpId } : {})
        } as any)
        if (!(result as { success?: boolean })?.success) {
          console.warn(`[voyager] ${failureMessage('get', result)}`)
        }
        return result
      } catch (err) {
        console.warn(`[voyager] ${failureMessage('get', undefined, err)}`)
        return { success: false, error: 'NotAllowedError', message: String((err as Error)?.message ?? err) }
      }
    }
  )
}
