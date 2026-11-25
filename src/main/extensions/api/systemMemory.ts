import { freemem, totalmem } from 'node:os'
import { registerExtensionApiHandler } from './registry'

const PATH = 'system.memory'

export function registerSystemMemory(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(_context, method, _args): unknown {
      if (method === 'getInfo') {
        return {
          capacity: totalmem(),
          availableCapacity: freemem()
        }
      }
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
