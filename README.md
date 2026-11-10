<h1 align="center">
  <img src="build/icon.svg" height="128" width="128"></img><br>
  Voyager
</h1>

A modern, pretty web browser built with Electron.

> [!WARNING]
> This project is mostly vibe-coded with OpenCode and is just an experiment. Most of the code is written by AI and reviewed by a human, treat it with caution.

## Stack

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Framing    | Electron 44, `BaseWindow` + `WebContentsView` per tab |
| Chrome UI  | React 19, TypeScript, Tailwind CSS, Zustand           |
| Build tool | electron-vite 5 (Vite 7)                              |
| Quality    | ESLint, Prettier, husky + commitlint hooks            |

## Getting started in development

Read [CONTRIBUTING.md](./CONTRIBUTING.md) to get started contributing to Voyager!

## Passkeys

Passkeys work out of the box on Windows and Linux. macOS platform passkeys use
Apple's `AuthenticationServices` and require an approved WebAuthn browser
entitlement plus a signed build with an embedded provisioning profile. See
[docs/passkeys.md](./docs/passkeys.md) for the setup and
`npm run dist:mac:passkeys` build command.

## Performance

This is a table of how Voyager performs on a MDN page:

| Resource                      | Amount    |
| ----------------------------- | --------- |
| Memory                        | 265.5 MB  |
| CPU                           | ~0.6%     |
| Disk (write, after 5 minutes) | 14.2 MB   |
| Disk (read, after 5 minutes)  | 957.55 MB |
