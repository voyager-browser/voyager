#!/usr/bin/env node
/**
 * Builds a signed macOS app with the restricted WebAuthn browser entitlement.
 *
 * Apple only grants `com.apple.developer.web-browser.public-key-credential` to
 * approved App IDs and only a provisioning profile can authorize it at runtime.
 * This script injects the Team ID into the entitlements template and points
 * electron-builder at the profile, keeping normal builds free of the restricted
 * entitlement.
 *
 * Usage:
 *   APPLE_TEAM_ID=ABCDE12345 npm run dist:mac:passkeys
 *   APPLE_TEAM_ID=ABCDE12345 APPLE_PROVISIONING_PROFILE=path/to/profile.provisionprofile npm run dist:mac:passkeys -- --dir
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'darwin') {
  console.error('Passkey builds use macOS entitlements and must run on macOS.')
  process.exit(1)
}

const teamId = (process.env.APPLE_TEAM_ID ?? '').trim().toUpperCase()
if (!/^[A-Z0-9]{10}$/.test(teamId)) {
  console.error('Set APPLE_TEAM_ID to your 10-character Apple Developer Team ID.')
  process.exit(1)
}

const profilePath = resolve(
  root,
  process.env.APPLE_PROVISIONING_PROFILE ?? 'build/profile.provisionprofile'
)
if (!existsSync(profilePath)) {
  console.error(`Provisioning profile not found at ${profilePath}.`)
  console.error(
    'Create a Developer ID (or development) profile for com.voyager.browser with the ' +
      '"Web Browser Public Key Credential Requests" capability, then set ' +
      'APPLE_PROVISIONING_PROFILE or place it at build/profile.provisionprofile.'
  )
  process.exit(1)
}

const templatePath = join(root, 'build/entitlements.mac.passkeys.plist')
const template = readFileSync(templatePath, 'utf8')
if (!template.includes('__APPLE_TEAM_ID__')) {
  console.error(`Expected __APPLE_TEAM_ID__ placeholder in ${templatePath}.`)
  process.exit(1)
}

const entitlementsPath = join(
  mkdtempSync(join(tmpdir(), 'voyager-passkey-entitlements-')),
  'entitlements.mac.plist'
)
writeFileSync(entitlementsPath, template.replaceAll('__APPLE_TEAM_ID__', teamId))

const builder = join(root, 'node_modules/.bin/electron-builder')
if (!existsSync(builder)) {
  console.error('electron-builder is not installed. Run npm install first.')
  process.exit(1)
}

execFileSync(
  builder,
  [
    '--mac',
    '--publish',
    'never',
    `-c.mac.entitlements=${entitlementsPath}`,
    `-c.mac.entitlementsInherit=${entitlementsPath}`,
    `-c.mac.provisioningProfile=${profilePath}`,
    ...process.argv.slice(2)
  ],
  { cwd: root, stdio: 'inherit' }
)
