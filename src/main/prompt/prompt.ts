import { randomUUID } from 'node:crypto'
import type { IpcMainEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type { PromptRequest } from '../../shared/types'
import type { WindowController } from '../window/WindowController'

interface PromptEntry {
  id: string
  window: WindowController
  event: IpcMainEvent
  message: string
  defaultValue: string
}

/**
 * A tab renderer blocks inside `ipcRenderer.sendSync` while a prompt is open,
 * so the prompt itself is rendered by the chrome UI of the owning window. Each
 * window shows one prompt at a time; additional prompts wait in a queue and the
 * tab that asked for them stays blocked until its turn is answered.
 */
const queues = new Map<WindowController, PromptEntry[]>()
const active = new Map<WindowController, PromptEntry>()
const entries = new Map<string, PromptEntry>()

function remove(entry: PromptEntry): void {
  entries.delete(entry.id)
  const queue = queues.get(entry.window)
  if (!queue) return
  const index = queue.indexOf(entry)
  if (index !== -1) queue.splice(index, 1)
  if (queue.length === 0) queues.delete(entry.window)
}

function showNext(window: WindowController): void {
  if (active.has(window)) return
  const queue = queues.get(window)
  const entry = queue?.shift()
  if (!entry) {
    queues.delete(window)
    return
  }
  if (queue && queue.length === 0) queues.delete(window)

  if (entry.event.sender.isDestroyed()) {
    entries.delete(entry.id)
    showNext(window)
    return
  }

  active.set(window, entry)
  window.focusChrome()
  window.sendToChrome(IpcChannels.UiPromptRequest, {
    id: entry.id,
    message: entry.message,
    defaultValue: entry.defaultValue
  } satisfies PromptRequest)
}

function settle(entry: PromptEntry, value: string | null): void {
  remove(entry)
  if (active.get(entry.window) !== entry) return
  active.delete(entry.window)
  try {
    entry.event.returnValue = value
  } catch {
    // The requesting renderer may have gone away while the prompt was open.
  }
  entry.window.tabs.focusActivePage()
  showNext(entry.window)
}

/** Queue a synchronous prompt request from a tab renderer. */
export function requestPrompt(
  window: WindowController,
  event: IpcMainEvent,
  payload: { message?: unknown; defaultValue?: unknown }
): void {
  const message = typeof payload?.message === 'string' ? payload.message : ''
  const defaultValue = typeof payload?.defaultValue === 'string' ? payload.defaultValue : ''
  const entry: PromptEntry = {
    id: randomUUID(),
    window,
    event,
    message,
    defaultValue
  }
  entries.set(entry.id, entry)
  const queue = queues.get(window) ?? []
  queue.push(entry)
  queues.set(window, queue)
  event.sender.once('destroyed', () => {
    const pending = entries.get(entry.id)
    if (pending) settle(pending, null)
  })
  showNext(window)
}

/** Resolve the active prompt; `null` means the user cancelled. */
export function respondToPrompt(id: string, value: unknown): void {
  const entry = entries.get(id)
  if (!entry || active.get(entry.window) !== entry) return
  settle(entry, typeof value === 'string' ? value : null)
}
