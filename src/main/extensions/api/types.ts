import type { Extension, IpcMainInvokeEvent, IpcMainServiceWorkerInvokeEvent } from 'electron'
import type { ExtensionApiCallRequest } from '../../../shared/extensionApi'

export type ExtensionApiInvokeEvent = IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent

/** Everything a namespace handler needs to know about the calling extension. */
export interface ExtensionApiContext {
  event?: ExtensionApiInvokeEvent
  profileId: string
  extensionId: string
  extension: Extension
  manifest: Record<string, unknown>
}

export type ExtensionApiCall = ExtensionApiCallRequest

export interface ExtensionApiHandlerSpec {
  /** Permission keys required globally or per method (`*` is the fallback). */
  permissions?: string[] | Record<string, string[]>
  invoke: (
    context: ExtensionApiContext,
    method: string,
    args: unknown[]
  ) => unknown | Promise<unknown>
}
