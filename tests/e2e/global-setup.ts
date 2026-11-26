import { execFileSync } from 'node:child_process'

export default function globalSetup(): void {
  const isWindows = process.platform === 'win32'
  execFileSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: isWindows
  })
  // The electron npm package downloads its binary lazily on first require.
  // Resolve it once before workers start so parallel launches cannot race the
  // same extraction (which surfaces as EACCES/ETXTBSY on CI).
  execFileSync(process.execPath, ['-e', "require('electron')"], { stdio: 'inherit' })
}
