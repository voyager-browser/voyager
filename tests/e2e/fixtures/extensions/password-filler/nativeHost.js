#!/usr/bin/env node

let pending = Buffer.alloc(0)

function readMessages(chunk) {
  pending = Buffer.concat([pending, chunk])
  while (pending.length >= 4) {
    const size = pending.readUInt32LE(0)
    if (size > 1024 * 1024) process.exit(1)
    if (pending.length < 4 + size) return
    const body = pending.subarray(4, 4 + size).toString('utf8')
    pending = pending.subarray(4 + size)
    const message = JSON.parse(body)
    const reply = Buffer.from(
      JSON.stringify({ echo: message && message.ping, from: 'native-host' }),
      'utf8'
    )
    const header = Buffer.alloc(4)
    header.writeUInt32LE(reply.length, 0)
    process.stdout.write(Buffer.concat([header, reply]))
  }
}

process.stdin.on('data', readMessages)
