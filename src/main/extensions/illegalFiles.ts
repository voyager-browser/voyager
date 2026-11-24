/**
 * Chromium rejects unpacked extensions that contain Windows-reserved file
 * names, even on macOS and Linux. Web Store CRXs frequently include metadata
 * such as desktop.ini, so strip those entries before loading the extension.
 */

import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const KNOWN_DEVICES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
  'clock$',
  'com¹',
  'com²',
  'com³',
  'lpt¹',
  'lpt²',
  'lpt³'
])

const MAGIC_NAMES = new Set(['desktop.ini', 'thumbs.db', 'conin$', 'conout$'])
const ARCHIVE_METADATA = new Set(['_metadata', '__macosx'])

/** Mirror Chromium's `IsReservedNameOnWindows` check. */
export function isWindowsReservedName(name: string): boolean {
  const lower = name.toLowerCase()
  const trimmed = lower.replace(/[ .]+$/, '')
  if (MAGIC_NAMES.has(trimmed)) return true
  const separator = trimmed.indexOf('.')
  const prefix = separator === -1 ? trimmed : trimmed.slice(0, separator).replace(/ +$/, '')
  return KNOWN_DEVICES.has(trimmed) || KNOWN_DEVICES.has(prefix)
}

/** Whether a CRX entry contains a name that would make loadExtension fail. */
export function isIllegalExtensionEntry(name: string): boolean {
  return name
    .split(/[\\/]/)
    .some(
      (part) =>
        part !== '' && (isWindowsReservedName(part) || ARCHIVE_METADATA.has(part.toLowerCase()))
    )
}

/** Remove illegal entries from an already-unpacked extension directory. */
export function removeIllegalExtensionFiles(root: string): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (!stat || stat.isSymbolicLink() || isIllegalExtensionEntry(entry)) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (stat.isDirectory()) removeIllegalExtensionFiles(path)
  }
}
