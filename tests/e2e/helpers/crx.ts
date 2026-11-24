interface ZipEntry {
  name: string
  content: Buffer
}

/** Minimal stored-entry ZIP writer for extension CRX test fixtures. */
export function storedZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(entry.content.length, 18)
    header.writeUInt32LE(entry.content.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.content)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(entry.content.length, 20)
    directory.writeUInt32LE(entry.content.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)

    offset += header.length + name.length + entry.content.length
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

/** Wrap a ZIP archive in a minimal CRX2 header accepted by Voyager. */
export function crx2(zip: Buffer): Buffer {
  const header = Buffer.alloc(16)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  return Buffer.concat([header, zip])
}

/** Build a CRX with just a manifest, optionally declaring an update URL. */
export function extensionCrx(manifest: Record<string, unknown>): Buffer {
  return crx2(
    storedZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) }])
  )
}
