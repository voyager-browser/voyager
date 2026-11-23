import { execFileSync } from 'node:child_process'

export default function globalSetup(): void {
  const isWindows = process.platform === 'win32'
  execFileSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: isWindows
  })
}
