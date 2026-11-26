import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import type { NativeMessagingHost } from '../../shared/types'
import { getSettings, setSettings } from '../store'

const HOSTS_KEY = 'nativeMessagingHosts'
const MAX_MESSAGE_BYTES = 1024 * 1024
const RESPONSE_TIMEOUT_MS = 30_000

/** Sender surface needed to scope a native messaging port to its owner. */
export interface NativeMessagingSender {
  id: string
  isDestroyed(): boolean
  onDestroyed(listener: () => void): void
  removeDestroyedListener(listener: () => void): void
}

/** Adapt a frame's WebContents to the native messaging sender surface. */
export function webContentsNativeSender(sender: WebContents): NativeMessagingSender {
  return {
    id: `web:${sender.id}`,
    isDestroyed: () => sender.isDestroyed(),
    onDestroyed: (listener) => sender.once('destroyed', listener),
    removeDestroyedListener: (listener) => sender.removeListener('destroyed', listener)
  }
}

interface NativePort {
  id: string
  extensionId: string
  sender: NativeMessagingSender
  child: ChildProcessWithoutNullStreams
  onMessage: (message: unknown, portId: string) => void
  onDisconnect: (portId: string) => void
  onSenderDestroyed: () => void
  closed: boolean
}

const ports = new Map<string, NativePort>()

function normalizeOrigin(value: string): string {
  if (value === '*' || value === '*/') return '*'
  return value.endsWith('/') ? value : `${value}/`
}

function isAllowedOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const origin = normalizeOrigin(value)
  return origin === '*' || origin.startsWith('chrome-extension://')
}

function isValidHost(value: unknown): value is NativeMessagingHost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const host = value as Record<string, unknown>
  return (
    typeof host.name === 'string' &&
    /^[a-zA-Z0-9._-]+$/.test(host.name) &&
    typeof host.path === 'string' &&
    isAbsolute(host.path) &&
    Array.isArray(host.allowedOrigins) &&
    host.allowedOrigins.length > 0 &&
    host.allowedOrigins.every(isAllowedOrigin) &&
    (host.description === undefined || typeof host.description === 'string')
  )
}

/** Native host configurations for one profile, sanitized against persisted junk. */
export function getNativeHosts(profileId: string): NativeMessagingHost[] {
  const stored = getSettings<unknown>(profileId, HOSTS_KEY, [])
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const result: NativeMessagingHost[] = []
  for (const candidate of stored) {
    if (!isValidHost(candidate) || seen.has(candidate.name)) continue
    seen.add(candidate.name)
    result.push({
      name: candidate.name,
      path: candidate.path,
      allowedOrigins: candidate.allowedOrigins.map(normalizeOrigin),
      ...(candidate.description === undefined ? {} : { description: candidate.description })
    })
  }
  return result
}

export function setNativeHosts(profileId: string, value: unknown): NativeMessagingHost[] {
  const hosts = getNativeHosts(profileId)
  if (!Array.isArray(value)) return hosts
  const seen = new Set<string>()
  const next: NativeMessagingHost[] = []
  for (const candidate of value) {
    if (!isValidHost(candidate) || seen.has(candidate.name)) continue
    seen.add(candidate.name)
    next.push({
      name: candidate.name,
      path: candidate.path,
      allowedOrigins: candidate.allowedOrigins.map(normalizeOrigin),
      ...(candidate.description === undefined ? {} : { description: candidate.description })
    })
  }
  setSettings(profileId, HOSTS_KEY, next)
  return next
}

function hostForExtension(
  profileId: string,
  hostName: string,
  extensionId: string
): NativeMessagingHost | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(hostName)) return null
  const origin = normalizeOrigin(`chrome-extension://${extensionId}`)
  return (
    getNativeHosts(profileId).find(
      (host) =>
        host.name === hostName &&
        (host.allowedOrigins.includes('*') || host.allowedOrigins.includes(origin))
    ) ?? null
  )
}

function releasePort(port: NativePort, terminate: boolean): void {
  if (port.closed) return
  port.closed = true
  ports.delete(port.id)
  if (!port.sender.isDestroyed()) {
    port.sender.removeDestroyedListener(port.onSenderDestroyed)
  }
  try {
    port.child.stdin.end()
  } catch {
    // The pipe may already be closed when the host exited first.
  }
  if (terminate) {
    try {
      if (!port.child.killed) port.child.kill()
    } catch {
      // The process may have already exited.
    }
  }
  port.onDisconnect(port.id)
}

function closePort(id: string): void {
  const port = ports.get(id)
  if (port) releasePort(port, true)
}

/**
 * End every native host's stdin during shutdown. A conforming host exits on
 * EOF; the parent process no longer holds an open child pipe that can delay a
 * graceful app.quit().
 */
export function closeAllNativePorts(): void {
  for (const port of [...ports.values()]) releasePort(port, false)
}

export interface NativeConnectionInput {
  profileId: string
  hostName: string
  extensionId: string
  sender: NativeMessagingSender
  onMessage: (message: unknown, portId: string) => void
  onDisconnect: (portId: string) => void
}

/** Start a stdio native messaging host and return an opaque port id. */
export function connectNative(input: NativeConnectionInput, id: string = randomUUID()): string {
  if (ports.has(id)) throw new Error('The native messaging port id is already in use.')
  const host = hostForExtension(input.profileId, input.hostName, input.extensionId)
  if (!host)
    throw new Error(`Native host "${input.hostName}" is not registered for this extension.`)

  const child = spawn(host.path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  const port: NativePort = {
    id,
    extensionId: input.extensionId,
    sender: input.sender,
    child,
    onMessage: input.onMessage,
    onDisconnect: input.onDisconnect,
    onSenderDestroyed: () => closePort(id),
    closed: false
  }
  ports.set(id, port)
  input.sender.onDestroyed(port.onSenderDestroyed)
  child.once('close', () => closePort(id))
  child.once('error', () => closePort(id))
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) console.warn(`[nativeMessaging:${host.name}] ${text}`)
  })

  let buffer = Buffer.alloc(0)
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0)
      if (size > MAX_MESSAGE_BYTES) {
        console.warn(`[nativeMessaging:${host.name}] Message too large; closing port.`)
        closePort(id)
        return
      }
      if (buffer.length < 4 + size) return
      const payload = buffer.subarray(4, 4 + size).toString('utf8')
      buffer = buffer.subarray(4 + size)
      try {
        if (!port.closed) port.onMessage(JSON.parse(payload), id)
      } catch {
        console.warn(`[nativeMessaging:${host.name}] Invalid JSON from native host.`)
      }
    }
  })

  return id
}

function writeToPort(portId: string, sender: NativeMessagingSender, message: unknown): boolean {
  const port = ports.get(portId)
  if (!port || port.closed || port.sender.id !== sender.id) return false
  try {
    const payload = Buffer.from(JSON.stringify(message ?? null), 'utf8')
    if (payload.length > MAX_MESSAGE_BYTES) return false
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    return port.child.stdin.write(Buffer.concat([header, payload]))
  } catch {
    return false
  }
}

export function postToNative(
  portId: string,
  sender: NativeMessagingSender,
  message: unknown
): boolean {
  return writeToPort(portId, sender, message)
}

export function disconnectNative(portId: string, sender: NativeMessagingSender): boolean {
  const port = ports.get(portId)
  if (!port || port.sender.id !== sender.id) return false
  closePort(portId)
  return true
}

export function sendNativeMessage(
  input: NativeConnectionInput,
  message: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    let portId = ''
    const cleanup = (): void => {
      clearTimeout(timeout)
      const port = ports.get(portId)
      if (port) {
        port.onMessage = () => {}
        port.onDisconnect = () => {}
      }
      closePort(portId)
    }
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('The native host did not respond in time.'))
    }, RESPONSE_TIMEOUT_MS)

    try {
      portId = connectNative(input)
    } catch (error) {
      clearTimeout(timeout)
      reject(error)
      return
    }
    input.onMessage = () => {}
    const port = ports.get(portId)
    if (port) {
      port.onMessage = (response) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(response)
      }
      port.onDisconnect = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(new Error('The native host disconnected before responding.'))
      }
    }
    if (!writeToPort(portId, input.sender, message)) {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Could not send the message to the native host.'))
    }
  })
}
