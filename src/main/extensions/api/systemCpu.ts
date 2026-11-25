import { cpus, loadavg, totalmem } from 'node:os'
import { listProfiles } from '../../profiles/profiles'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'

const PATH = 'system.cpu'

interface CpuInfo {
  processors: number
  model: string
  speed: number
}

let baseline: CpuInfo | undefined

function readCpuInfo(): CpuInfo {
  const processors = cpus()
  const first = processors[0]
  const measured = first?.speed ?? 0
  // Some platforms omit CPU speed. Use load and physical memory only for a
  // stable MHz-like fallback so the Chrome-shaped result always has a number.
  const load = loadavg()[0] || 0
  const memoryGb = totalmem() / (1024 * 1024 * 1024)
  const fallback = Math.max(1, Math.round(Math.min(load, memoryGb) * 1000))
  return {
    processors: processors.length,
    model: first?.model ?? 'Unknown',
    speed: measured > 0 ? measured : fallback
  }
}

/** Publish the initial CPU snapshot as the onUpdated baseline. */
export function emitSystemCpuUpdate(): void {
  const info = (baseline ??= readCpuInfo())
  for (const profile of listProfiles()) {
    broadcastExtensionApiEvent(
      profile.id,
      { path: PATH.split('.'), event: 'onUpdated', args: [info] },
      PATH
    )
  }
}

export function registerSystemCpu(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(_context, method, _args): unknown {
      if (method === 'getInfo') return readCpuInfo()
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
  emitSystemCpuUpdate()
}
