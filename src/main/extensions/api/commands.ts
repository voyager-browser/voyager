import { globalShortcut, type Session } from 'electron'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

interface CommandSpec {
  description?: string
  suggested_key?: Record<string, unknown>
}

interface CommandBinding {
  profileId: string
  extensionId: string
  name: string
  accelerator: string
}

const bindings = new Map<string, CommandBinding>()
const RESERVED = new Set([
  '_execute_action',
  '_execute_browser_action',
  '_execute_page_action',
  '_execute_sidebar_action'
])

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function platformKey(spec: CommandSpec): string | undefined {
  const keys = spec.suggested_key ?? {}
  const platform =
    process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'windows'
  const value = keys[platform] ?? keys.default
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Translate Chrome's suggested-key format into an Electron accelerator. */
export function chromeKeyToAccelerator(value: string): string {
  return value
    .split('+')
    .map((part) => {
      const key = part.trim()
      if (key === 'Ctrl') return 'CommandOrControl'
      if (key === 'MacCtrl') return 'Control'
      if (key === 'Command') return 'Command'
      return key
    })
    .filter(Boolean)
    .join('+')
}

function commandsFor(extensionManifest: Record<string, unknown>): Record<string, CommandSpec> {
  const raw = record(extensionManifest.commands)
  const commands: Record<string, CommandSpec> = {}
  for (const [name, value] of Object.entries(raw)) {
    const spec = record(value)
    commands[name] = {
      ...(typeof spec.description === 'string' ? { description: spec.description } : {}),
      suggested_key: record(spec.suggested_key)
    }
  }
  return commands
}

function unregister(binding: CommandBinding): void {
  try {
    globalShortcut.unregister(binding.accelerator)
  } catch {
    // An accelerator can already be owned by another extension or the OS.
  }
}

/**
 * Register manifest command accelerators for the loaded extensions in a
 * profile. Conflicting or unavailable accelerators are skipped instead of
 * stealing an existing browser/OS shortcut.
 */
export function refreshCommandShortcuts(ses: Session, profileId: string): void {
  const desired = new Map<string, CommandBinding>()
  for (const extension of ses.extensions.getAllExtensions()) {
    const manifest = (extension.manifest ?? {}) as Record<string, unknown>
    for (const [name, spec] of Object.entries(commandsFor(manifest))) {
      const shortcut = platformKey(spec)
      if (!shortcut) continue
      const accelerator = chromeKeyToAccelerator(shortcut)
      desired.set(accelerator, {
        profileId,
        extensionId: extension.id,
        name,
        accelerator
      })
    }
  }

  for (const [accelerator, binding] of bindings) {
    if (desired.get(accelerator)?.extensionId !== binding.extensionId) {
      unregister(binding)
      bindings.delete(accelerator)
    }
  }

  for (const [accelerator, binding] of desired) {
    if (bindings.has(accelerator)) continue
    try {
      const registered = globalShortcut.register(accelerator, () => {
        broadcastExtensionApiEvent(
          binding.profileId,
          { path: ['commands'], event: 'onCommand', args: [binding.name] },
          undefined
        )
      })
      if (registered) bindings.set(accelerator, binding)
    } catch {
      // The app may not be ready or another owner may hold the accelerator.
    }
  }
}

export function registerCommands(): void {
  registerExtensionApiHandler('commands', {
    invoke(context, method, _args): unknown {
      if (method === 'getAll') {
        const manifest = (context.extension.manifest ?? {}) as Record<string, unknown>
        return Object.entries(commandsFor(manifest))
          .filter(([name]) => !RESERVED.has(name))
          .map(([name, spec]) => ({
            name,
            ...(spec.description === undefined ? {} : { description: spec.description }),
            ...(platformKey(spec) === undefined ? {} : { shortcut: platformKey(spec) })
          }))
      }
      throw new Error(`chrome.commands.${method} is not supported.`)
    }
  })
}
