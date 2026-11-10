# Passkeys and WebAuthn

Voyager enables `publickey-credentials-create` and `publickey-credentials-get`, so
websites can use passkeys and security keys on every platform.

| Platform | WebAuthn implementation                                               |
| -------- | --------------------------------------------------------------------- |
| Windows  | Chromium's native WebAuthn (Windows Hello, security keys, phone)      |
| Linux    | Chromium's native WebAuthn (security keys, phone)                     |
| macOS    | `electron-webauthn` bridge backed by Apple's `AuthenticationServices` |

On macOS, the tab preload routes `navigator.credentials.create()` and
`navigator.credentials.get()` through the bridge so Voyager can act as a browser
for **any** relying-party domain. Electron 45's built-in platform authenticator
only works for domains listed in the app's Associated Domains entitlement, so it
cannot serve arbitrary websites. Voyager still calls
`app.configureWebAuthn({ platformPasskeys: true })` so that feature detection
(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` and
`getClientCapabilities()`) reports a usable platform authenticator.

## Why passkeys fail in `npm run dev` on macOS

Apple restricts the browser passkey capability
(`com.apple.developer.web-browser.public-key-credential`). An app can only use it
when:

1. Apple has approved the capability for the app's App ID, and
2. the app is signed with a provisioning profile that contains the capability.

`npm run dev` launches the stock `Electron.app`, which is signed by the Electron
team and does not carry Voyager's entitlement. There is no way to attach the
entitlement to that binary retroactively. The bridge therefore fails with
`NotAllowedError`; Voyager now logs the underlying `AuthenticationServices`
error to both the main process and the page console to make this obvious.

Windows and Linux are not affected and work in development.

## Building an entitled macOS app

You need an Apple Developer Program account. A free personal team cannot request
the browser passkey capability.

1. In [Apple Developer](https://developer.apple.com/account), open **Identifiers**
   and select the `com.voyager.browser` App ID.
2. Under **Capability Requests**, request **Web Browser Public Key Credential
   Requests** (or enable **Associated Domains** if you only need specific
   domains). Wait for Apple's approval.
3. Create a **Developer ID** provisioning profile for that App ID. For local
   testing, a **Development** profile also works.
4. Save the profile as `build/profile.provisionprofile` (gitignored), or point
   `APPLE_PROVISIONING_PROFILE` at it.
5. Find your 10-character Team ID and build:

   ```sh
   APPLE_TEAM_ID=ABCDE12345 npm run dist:mac:passkeys
   ```

   For an unsigned structural test of the packaging step, append `-- --dir`.

The `dist:mac:passkeys` script generates a temporary entitlements file from
[`build/entitlements.mac.passkeys.plist`](../build/entitlements.mac.passkeys.plist),
injects your Team ID, and lets electron-builder embed the provisioning profile.
The normal `npm run dist` / `dist:mac` path deliberately omits the restricted
entitlement so builds without an approved profile keep working.

Verify the result:

```sh
codesign -d --entitlements :- dist/mac-universal/Voyager.app
ls dist/mac-universal/Voyager.app/Contents/embedded.provisionprofile
```

The entitlements should include `com.apple.developer.web-browser.public-key-credential`
and the application identifier should be `<TEAM_ID>.com.voyager.browser`.

## Troubleshooting

- **`NotAllowedError` in development** — expected on macOS; use a signed,
  entitled build (see above).
- **"The calling process does not have an application identifier" (error 1004)**
  — `com.apple.application-identifier` is missing or does not match the profile.
  Re-run `dist:mac:passkeys` with the correct `APPLE_TEAM_ID`.
- **No passkey sheet appears in an entitled build** — confirm the provisioning
  profile is embedded at `Contents/embedded.provisionprofile` and that Apple
  approved the Web Browser Public Key Credential capability for the App ID.
- **Security keys** — external authenticators are handled by the same macOS
  bridge, so they use the same signed build requirements there. They work
  without extra setup on Windows and Linux.
