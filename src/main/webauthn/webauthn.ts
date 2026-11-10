import type { IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { WindowController } from '../window/WindowController'

interface IpcContext {
  getWindow(event?: IpcMainInvokeEvent): WindowController | null | undefined
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
        return result
      } catch (err) {
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
        return result
      } catch (err) {
        return { success: false, error: 'NotAllowedError', message: String((err as Error)?.message ?? err) }
      }
    }
  )
}
