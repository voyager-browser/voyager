# Contributing to Voyager

Thank you for taking the time to contribute to [Voyager](https://github.com/voyager-browser/voyager)! :tada:

This document covers:

- Guidelines for contributing to Voyager
- The stack for Voyager
- How your code will be tested

## Get started

Getting started requires a few dependencies before development. Here are the things you need:

| Engine  | (at least this) Version |
| ------- | ----------------------- |
| Node.js | 22.12.10                |
| npm     | v10                     |

## You need...

These are things you should consider learning before you start contributing to Voyager.

- [TypeScript 7](https://typescriptdocs.com/get-started/) _(the primary code language of Voyager)_
- [Electron](https://electronjs.org) _(the desktop part of Voyager)_
- [Playwright](https://playwright.dev) _(the testing suite of Voyager)_
- [electron-builder](https://electron.build) _(the part that builds Voyager)_
- [eslint](https://eslint.org) _(the code-checking tool that CI for Voyager uses)_
- [Vite](https://vite.dev/) _(the one of two frontends that Voyager uses)_
- [React](https://react.dev) _(the one of two frotends that Voyager uses)_
- [TailwindCSS](https://tailwindcss.com/) _(helps the frontends more with more stylish appearances)_

## Start contributing!

You should pick which part of Voyager you want to contribute to.

### Tests

In our GitHub Actions CI tests, your commit must:

- Not have a vulnerable package. _(This is provided by Socket Security, and is not open-source.)_
- Pass the E2E Playwright tests that you have added to your code, and past tests. _(which is required)_
- The PR title and all commits in that PR must follow [Conventional Commits](https://conventionalcommits.org) format.
- Your TypeScript code must compile correctly using the `tsc` command.
- Your code, as a whole, must pass `eslint`'s standards. If you have an error here, don't worry! Check the [fixing errors section](#fixing-errors).

If you are trying to change one of these tests, like the actions provided in the `.github` folder, these usually have a scope of `ci` or `build`. This is also usually the same for [test helpers](#test-helpers).

#### Test helpers

Our E2E Playwright tests have helpers to make writing tests easier, simpler, and with less code. These helpers are located in `tests/e2e/helpers` and there are two files. The two files are described in the next sections.

##### `server.ts`

`server.ts` is a file to keep the server part organized. Voyager will navigate to a temporary server on a random port with the [Voyager test helper](#voyager-ts) and run some tests. This helps, and there is a lot of `{PORT}` sections. Please do not set these to a hardcoded port like HTTP `80` or HTTPS `443`, as the tests will determine them randomly in order to not conflict with already-running processes on the system, listening on ports.

##### `voyager.ts`

`voyager.ts` is a test helper to help keep Voyager itself organized. It has multiple functions like:

- Passing along the `ElectronApplication` to the test, in case it needs it.
- Sharing the tab contents **only while running a test**.
- Sharing the user data directory and the download directory.
- Exposing APIs like closing tabs, opening tabs, and getting active tabs.

### Backend

Most of our backend code is in `src/main`, the foundation of Voyager. Some of these communicate with Electron, and some of these may have helpers. Those helpers are located in `src/shared`, which are described more in the [next section](#backend-helpers).

#### Backend helpers

Helpers or shared code is in `src/shared`. These helpers are here to make life simpler and our code shorter and more legible. Use these helpers if needed, look in the helpers, see if there's anything that could help you in your backend code.

### Frontend

We do tend to have a lot more frontend code, therefore why we have ~5 packages simply devoted to frontend code. Frontend is usually made in a stack of Vite, React, and TailwindCSS. These are in `src/preload` and `src/renderer`. Make sure to add tests when you do so!

## Some ground rules

- If your code is frontend (and sometimes backend), try to add Playwright tests.
- Make sure your code passes using ESLint.
- Run tests locally, see if something is broken, and if it is, then yes. A test failing may be only devoted to the CI runner, it runs on Linux.

## Fixing errors

ESLint's fix command and Prettier could optimize your code and fix it for you.

### ESLint errors

Run ESLint's fix command, wrapped up in our project as a script command and a developer dependency: `npm run lint:fix`

### Prettify your code

Prettify your code with Prettier, wrapped up in our project as a script command and a developer dependency: `npm run format`

## That's it!

Happy coding, and thank you for contributing to Voyager!
