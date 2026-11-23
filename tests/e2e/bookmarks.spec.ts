import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import type { BookmarkMoveInput } from '../../src/shared/types'
import { isNewTab } from '../../src/shared/url'
import { pressPageShortcut, primaryKey, primaryModifier } from './helpers/voyager'

test('bookmark bar toggles from the keyboard', async ({ voyager }) => {
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(false)

  const mod = primaryKey()
  await voyager.chrome.locator('body').press(`${mod}+Shift+B`)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(true)
  await expect(voyager.chrome.locator('nav')).toBeVisible()

  await voyager.chrome.locator('body').press(`${mod}+Shift+B`)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(false)
  await expect(voyager.chrome.locator('nav')).toHaveCount(0)
})

test('adds, dedupes, navigates and removes a bookmark', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  const bookmarkBtn = voyager.chrome.getByRole('button', {
    name: /Bookmark this page|Remove bookmark/
  })
  await expect(bookmarkBtn).toBeEnabled()
  await bookmarkBtn.click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(1)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(true)

  // Dedupe through the bookmark API.
  await voyager.chrome.evaluate(async (url: string) => {
    await window.voyager.bookmarks.add({ title: 'Voyager Test Home', url })
    await window.voyager.bookmarks.add({ title: 'Voyager Test Home', url })
  }, server.url('/home'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(1)

  // The bookmarks bar appears automatically on the first bookmark.

  const items = (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items
  expect(items[0].title).toBe('Voyager Test Home')
  expect(items[0].url).toBe(server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+T`)
  await expect.poll(async () => isNewTab((await voyager.activeTab()).url)).toBe(true)

  await voyager.navigate(server.url('/second'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/second'))

  await voyager.chrome.locator('nav button').first().click()
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await voyager.chrome.evaluate(async () => {
    const state = await window.voyager.bookmarks.getState()
    if (state.items[0]) await window.voyager.bookmarks.remove(state.items[0].id)
  })
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)
  // Removing the last bookmark hides the bar again instead of leaving an
  // empty strip behind.
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).barVisible
    )
    .toBe(false)
  await expect(voyager.chrome.locator('nav')).toHaveCount(0)
})

test('disables bookmark button on a blank tab', async ({ voyager }) => {
  await expect(voyager.chrome.getByRole('button', { name: 'Bookmark this page' })).toBeDisabled()
})

async function bookmarkItems(voyager: { chrome: Page }): Promise<{
  items: Array<{ id: string; title: string; url: string; folderId: string | null }>
  folders: Array<{ id: string; title: string; parentId: string | null }>
}> {
  return voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())
}

test('stars and unstars the active page with Cmd/Ctrl+D', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  await voyager.chrome.locator('body').press(`${primaryKey()}+d`)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(1)
  await expect(voyager.chrome.locator('nav button').first()).toBeVisible()

  await voyager.chrome.locator('body').press(`${primaryKey()}+d`)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)
})

test('Cmd/Ctrl+D removes a bookmark stored in a folder', async ({ voyager, server }) => {
  const url = server.url('/home')
  await voyager.navigate(url)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(url)

  const bookmarkInFolder = async (): Promise<void> => {
    await voyager.chrome.evaluate(
      async (input: { url: string }) => {
        let state = await window.voyager.bookmarks.getState()
        let folder = state.folders.find((candidate) => candidate.title === 'Research')
        if (!folder) {
          state = await window.voyager.bookmarks.addFolder({ title: 'Research' })
          folder = state.folders.find((candidate) => candidate.title === 'Research')
        }
        if (!folder) throw new Error('Folder not created')
        await window.voyager.bookmarks.add({
          title: 'Voyager Test Home',
          url: input.url,
          folderId: folder.id
        })
      },
      { url }
    )
  }

  await bookmarkInFolder()
  await expect(voyager.chrome.getByRole('button', { name: 'Remove bookmark' })).toBeVisible()

  // The chrome-focused shortcut uses the renderer store.
  await voyager.chrome.locator('body').press(`${primaryKey()}+d`)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)
  await expect(voyager.chrome.getByRole('button', { name: 'Bookmark this page' })).toBeVisible()

  // The page-focused shortcut is handled in the main process and must agree.
  await bookmarkInFolder()
  await expect(voyager.chrome.getByRole('button', { name: 'Remove bookmark' })).toBeVisible()
  await pressPageShortcut(voyager, 'd', [primaryModifier()])
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)

  // Only the bookmark was removed; the holding folder is untouched.
  expect((await bookmarkItems(voyager)).folders.map((folder) => folder.title)).toEqual(['Research'])
})

test('bookmarks manager adds folders and bookmarks and allows duplicates per folder', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/home'))
  await voyager.chrome.locator('body').press(`${primaryKey()}+Shift+O`)
  const manager = voyager.chrome.getByRole('dialog', { name: 'Bookmarks Manager' })
  await expect(manager).toBeVisible()

  await manager.getByRole('button', { name: 'Add Folder', exact: true }).click()
  const addDialog = voyager.chrome.getByRole('dialog', { name: 'Add Folder' })
  await expect(addDialog).toBeVisible()
  await addDialog.getByLabel('Name').fill('Research')
  await addDialog.getByRole('button', { name: 'Add Folder' }).click()
  await expect(addDialog).not.toBeVisible()

  const state = await bookmarkItems(voyager)
  const folder = state.folders.find((candidate) => candidate.title === 'Research')
  expect(folder).toBeTruthy()
  await expect
    .poll(async () =>
      (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).folders.some(
        (folder: { title: string }) => folder.title === 'Research'
      )
    )
    .toBe(true)
  await expect(manager.getByRole('button', { name: 'Research' }).first()).toBeVisible({
    timeout: 15000
  })
  await manager.getByRole('button', { name: 'Research' }).first().click()

  await manager.getByRole('button', { name: 'Add Page' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(1)

  const items = (await bookmarkItems(voyager)).items
  expect(items).toHaveLength(1)
  expect(items[0].folderId).toBe(folder?.id)

  // The same URL can now live in two different folders at once.
  await voyager.chrome.evaluate(
    async (input: { title: string; url: string; folderId?: string }) => {
      await window.voyager.bookmarks.add(input)
    },
    { title: server.url('/home'), url: server.url('/home') }
  )
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(2)
})

test('shows favicons for bookmarks inside a folder', async ({ voyager, server }) => {
  const favicon = server.url('/favicon.svg')

  await voyager.chrome.evaluate(
    async (input: { url: string; favicon: string }) => {
      const state = await window.voyager.bookmarks.addFolder({ title: 'Research' })
      const folder = state.folders.find((candidate) => candidate.title === 'Research')
      if (!folder) throw new Error('Folder not created')
      await window.voyager.bookmarks.add({
        title: 'Favicon Site',
        url: input.url,
        favicon: input.favicon,
        folderId: folder.id
      })
    },
    { url: server.url('/home'), favicon }
  )

  const folderButton = voyager.chrome.getByRole('button', { name: 'Folder Research' })
  await expect(folderButton).toBeVisible()
  await folderButton.click()

  const item = voyager.chrome.getByRole('menu').getByRole('menuitem', { name: 'Favicon Site' })
  await expect(item.locator('img')).toHaveAttribute('src', favicon)
})

test('modified click on a folder opens only the folder context menu', async ({
  voyager,
  server
}) => {
  await voyager.chrome.evaluate(async (url) => {
    const state = await window.voyager.bookmarks.addFolder({ title: 'Research' })
    const folder = state.folders.find((candidate) => candidate.title === 'Research')
    if (!folder) throw new Error('Folder not created')
    await window.voyager.bookmarks.add({
      title: 'Research Site',
      url,
      folderId: folder.id
    })
  }, server.url('/home'))

  const folderButton = voyager.chrome.getByRole('button', { name: 'Folder Research' })
  await expect(folderButton).toBeVisible()

  // A plain click still opens the folder's bookmark list.
  await folderButton.click()
  await expect(voyager.chrome.getByRole('menu')).toHaveCount(1)
  await expect(
    voyager.chrome.getByRole('menu').getByRole('menuitem', { name: 'Research Site' })
  ).toBeVisible()
  await expect(
    voyager.chrome.getByRole('menu').getByRole('menuitem', { name: 'Edit…' })
  ).toHaveCount(0)
  await voyager.chrome.keyboard.press('Escape')
  await expect(voyager.chrome.getByRole('menu')).toHaveCount(0)

  // A modified click opens the context menu, not the bookmark list as well.
  await folderButton.click({ modifiers: [primaryKey()] })
  const menu = voyager.chrome.getByRole('menu')
  await expect(menu).toHaveCount(1)
  await expect(menu.getByRole('menuitem', { name: 'Open All in New Tabs' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Edit…' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Research Site' })).toHaveCount(0)
})

test.skip('bookmark context menu opens, edits, copies and deletes a bookmark (pending context-menu trigger fix)', async ({
  voyager,
  server
}) => {
  await voyager.navigate(server.url('/home'))
  await voyager.chrome.getByRole('button', { name: 'Bookmark this page' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(1)

  await voyager.chrome
    .locator('nav button')
    .first()
    .click({ modifiers: ['Control'] })
  const menu = voyager.chrome.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Open in New Tab' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Open in New Window' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Edit…' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Cut' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Paste' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible()

  // Opening in a new tab closes the menu and spins up a secondary tab.
  await menu.getByRole('menuitem', { name: 'Open in New Tab' }).click()
  await expect.poll(async () => (await voyager.state()).tabs.length).toBe(2)
  await expect.poll(async () => (await voyager.activeTab()).url).toBe(server.url('/home'))

  // Reopen the context menu for the remaining actions.
  await voyager.chrome
    .locator('nav button')
    .first()
    .click({ modifiers: ['Control'] })
  const editMenu = voyager.chrome.getByRole('menu')
  await expect(editMenu.getByRole('menuitem', { name: 'Edit…' })).toBeVisible()
  await editMenu.getByRole('menuitem', { name: 'Edit…' }).click()
  const editDialog = voyager.chrome.getByRole('dialog', { name: 'Edit Bookmark' })
  await expect(editDialog).toBeVisible()
  await editDialog.getByLabel('Name').fill('Renamed Page')
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items[0]?.title
    )
    .toBe('Renamed Page')

  await voyager.chrome
    .locator('nav button')
    .first()
    .click({ modifiers: ['Control'] })
  const copyMenu = voyager.chrome.getByRole('menu')
  await expect(copyMenu.getByRole('menuitem', { name: 'Copy' })).toBeVisible()
  await copyMenu.getByRole('menuitem', { name: 'Copy' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).clipboard?.mode
    )
    .toBe('copy')

  await voyager.chrome
    .locator('nav button')
    .first()
    .click({ modifiers: ['Control'] })
  const deleteMenu = voyager.chrome.getByRole('menu')
  await expect(deleteMenu.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  await deleteMenu.getByRole('menuitem', { name: 'Delete' }).click()
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)
})

test('moves a bookmark into another position', async ({ voyager, server }) => {
  await voyager.navigate(server.url('/home'))
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(0)

  await voyager.chrome.evaluate(
    async (urls: string[]) => {
      for (const url of urls) {
        await window.voyager.bookmarks.add({ title: url, url })
      }
    },
    [server.url('/home'), server.url('/second')]
  )
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items.length
    )
    .toBe(2)

  const first = (await bookmarkItems(voyager)).items[0]
  const second = (await bookmarkItems(voyager)).items[1]

  const moveInput: BookmarkMoveInput = {
    kind: 'bookmark',
    id: second.id,
    parentId: null,
    beforeId: first.id
  }
  await voyager.chrome.evaluate(async (input: BookmarkMoveInput) => {
    await window.voyager.bookmarks.move(input)
  }, moveInput)
  await expect
    .poll(
      async () =>
        (await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())).items[0]?.id ===
        second.id
    )
    .toBe(true)
})

test('copying a folder into itself or its descendants cannot recurse', async ({
  voyager,
  server
}) => {
  const { folder, child } = await voyager.chrome.evaluate(async (url: string) => {
    const parentState = await window.voyager.bookmarks.addFolder({ title: 'Parent' })
    const parent = parentState.folders.find((candidate) => candidate.title === 'Parent')
    if (!parent) throw new Error('Parent folder not created')
    const childState = await window.voyager.bookmarks.addFolder({
      title: 'Child',
      parentId: parent.id
    })
    const child = childState.folders.find((candidate) => candidate.title === 'Child')
    if (!child) throw new Error('Child folder not created')
    await window.voyager.bookmarks.add({ title: 'Parent page', url, folderId: parent.id })
    await window.voyager.bookmarks.add({ title: 'Child page', url, folderId: child.id })
    return { folder: parent, child }
  }, server.url('/home'))

  const snapshot = async () => {
    const state = await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())
    return {
      folders: state.folders.map(({ id, title, parentId }) => ({ id, title, parentId })),
      items: state.items.map(({ id, title, folderId }) => ({ id, title, folderId }))
    }
  }

  const original = await snapshot()
  expect(original.folders).toHaveLength(2)
  expect(original.items).toHaveLength(2)

  // Pasting F into F itself must be a no-op, not unbounded cloning.
  await voyager.chrome.evaluate(async (id: string) => {
    await window.voyager.bookmarks.copy('folder', id)
    await window.voyager.bookmarks.paste(id)
  }, folder.id)
  expect(await snapshot()).toEqual(original)

  // The destination must not be inside the copied subtree either.
  const rejected = await voyager.chrome.evaluate(
    async (input: { source: string; destination: string }) => {
      await window.voyager.bookmarks.copy('folder', input.source)
      try {
        await window.voyager.bookmarks.paste(input.destination)
        return false
      } catch {
        return true
      }
    },
    { source: folder.id, destination: child.id }
  )
  expect(rejected).toBe(true)
  expect(await snapshot()).toEqual(original)

  // A valid destination still clones the original subtree exactly once.
  await voyager.chrome.evaluate(async (source: string) => {
    await window.voyager.bookmarks.copy('folder', source)
    await window.voyager.bookmarks.paste(null)
  }, folder.id)
  const copied = await voyager.chrome.evaluate(() => window.voyager.bookmarks.getState())
  const parents = copied.folders.filter((candidate) => candidate.title === 'Parent')
  const children = copied.folders.filter((candidate) => candidate.title === 'Child')
  expect(parents).toHaveLength(2)
  expect(children).toHaveLength(2)
  expect(children.filter((candidate) => candidate.parentId === parents[0]?.id)).toHaveLength(1)
  expect(children.filter((candidate) => candidate.parentId === parents[1]?.id)).toHaveLength(1)
  expect(copied.items).toHaveLength(4)
})
