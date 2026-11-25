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

/** Minimal stored-entry ZIP writer using ZIP64 headers and end records. */
export function storedZip64(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')

    const localExtra = Buffer.alloc(20)
    localExtra.writeUInt16LE(0x0001, 0)
    localExtra.writeUInt16LE(12, 2)
    localExtra.writeBigUInt64LE(BigInt(entry.content.length), 4)
    localExtra.writeBigUInt64LE(BigInt(entry.content.length), 12)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(45, 4)
    header.writeUInt32LE(0xffffffff, 18)
    header.writeUInt32LE(0xffffffff, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(localExtra.length, 28)
    local.push(header, name, localExtra, entry.content)

    const centralExtra = Buffer.alloc(28)
    centralExtra.writeUInt16LE(0x0001, 0)
    centralExtra.writeUInt16LE(24, 2)
    centralExtra.writeBigUInt64LE(BigInt(entry.content.length), 4)
    centralExtra.writeBigUInt64LE(BigInt(entry.content.length), 12)
    centralExtra.writeBigUInt64LE(BigInt(offset), 20)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(45, 4)
    directory.writeUInt16LE(45, 6)
    directory.writeUInt32LE(0xffffffff, 20)
    directory.writeUInt32LE(0xffffffff, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(centralExtra.length, 30)
    directory.writeUInt32LE(0xffffffff, 42)
    central.push(directory, name, centralExtra)

    offset += header.length + name.length + localExtra.length + entry.content.length
  }

  const centralOffset = offset
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const zip64Offset = centralOffset + centralSize

  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(BigInt(entries.length), 24)
  zip64End.writeBigUInt64LE(BigInt(entries.length), 32)
  zip64End.writeBigUInt64LE(BigInt(centralSize), 40)
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(zip64Offset), 8)
  locator.writeUInt32LE(1, 16)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)

  return Buffer.concat([...local, ...central, zip64End, locator, end])
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
