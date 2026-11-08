import { app } from 'electron'
import { join } from 'node:path'
import { readJsonFile, writeJsonFile } from './jsonFile'

const WRITE_DEBOUNCE_MS = 250

/**
 * Small typed JSON store for one file in a profile's data directory. Reads
 * once at startup, merges onto defaults, and writes with a debounced atomic
 * save. Call `flush()` on shutdown so debounced writes are never lost.
 */
export class Store<T extends object> {
  private readonly fileName: string
  private readonly directory: string
  private data: T
  private timer: NodeJS.Timeout | null = null

  constructor(fileName: string, defaults: T, directory?: string) {
    this.fileName = fileName
    this.directory = directory ?? app.getPath('userData')
    this.data = { ...defaults, ...readJsonFile<Partial<T>>(this.filePath(), {}) }
  }

  private filePath(): string {
    return join(this.directory, this.fileName)
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  /** Assign a key and schedule a write. */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
    this.scheduleWrite()
  }

  /** Mutate a nested value in place via a callback and schedule a write. */
  update<K extends keyof T>(key: K, updater: (value: T[K]) => T[K]): void {
    this.data[key] = updater(this.data[key])
    this.scheduleWrite()
  }

  get snapshot(): T {
    return { ...this.data }
  }

  /** Write immediately and cancel any pending debounce. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    writeJsonFile(this.filePath(), this.data)
  }

  private scheduleWrite(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      writeJsonFile(this.filePath(), this.data)
    }, WRITE_DEBOUNCE_MS)
  }
}
