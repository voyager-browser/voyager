import {
  app,
  Menu,
  type ContextMenuParams,
  type MenuItem,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
  webContents as electronWebContents
} from 'electron'
import { asExtensionTab, extensionTabEntries } from '../tabProjection'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'

interface MenuItemRecord {
  id: string
  title?: string
  type?: 'normal' | 'checkbox' | 'radio' | 'separator'
  contexts?: string[]
  checked?: boolean
  enabled?: boolean
  disabled?: boolean
  visible?: boolean
  parentId?: string
}

const attached = new WeakSet<Session>()
const watched = new WeakSet<WebContents>()
let nextId = 0

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const keyFor = (extensionId: string): string => `contextMenus:${extensionId}`

function readItems(profileId: string, extensionId: string): MenuItemRecord[] {
  const stored = getApiSetting<MenuItemRecord[]>(profileId, keyFor(extensionId), [])
  return Array.isArray(stored) ? stored : []
}

function writeItems(profileId: string, extensionId: string, items: MenuItemRecord[]): void {
  setApiSetting(profileId, keyFor(extensionId), items)
}

function normalizeItem(
  id: string,
  input: Record<string, unknown>,
  parentId?: string
): MenuItemRecord {
  const typeValue = input.type
  const type =
    typeValue === 'checkbox' || typeValue === 'radio' || typeValue === 'separator'
      ? typeValue
      : 'normal'
  return {
    id,
    type,
    ...(typeof input.title === 'string' ? { title: input.title } : {}),
    ...(Array.isArray(input.contexts)
      ? { contexts: input.contexts.filter((value): value is string => typeof value === 'string') }
      : {}),
    ...(typeof input.checked === 'boolean' ? { checked: input.checked } : {}),
    ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
    ...(typeof input.disabled === 'boolean' ? { disabled: input.disabled } : {}),
    ...(typeof input.visible === 'boolean' ? { visible: input.visible } : {}),
    ...(parentId === undefined ? {} : { parentId })
  }
}

function actualContexts(params: ContextMenuParams, webContents: WebContents): string[] {
  const contexts = new Set<string>(['page'])
  if (params.selectionText) contexts.add('selection')
  if (params.linkURL) contexts.add('link')
  if (params.isEditable) contexts.add('editable')
  if (params.mediaType === 'image') contexts.add('image')
  if (params.mediaType === 'video') contexts.add('video')
  if (params.mediaType === 'audio') contexts.add('audio')
  if (params.frameURL && params.frameURL !== params.pageURL) contexts.add('frame')
  try {
    if (webContents.getType() === 'webview') contexts.add('frame')
  } catch {
    // WebContents can disappear while the context menu is being prepared.
  }
  return [...contexts]
}

function matchesContexts(item: MenuItemRecord, contexts: string[]): boolean {
  const declared = item.contexts ?? ['page']
  return declared.some(
    (value) => value === 'all' || (value === 'selection' ? true : contexts.includes(value))
  )
}

function clickInfo(
  params: ContextMenuParams,
  item: MenuItemRecord,
  checked: boolean
): Record<string, unknown> {
  return {
    menuItemId: item.id,
    ...(item.parentId === undefined ? {} : { parentMenuItemId: item.parentId }),
    ...(params.mediaType && params.mediaType !== 'none' ? { mediaType: params.mediaType } : {}),
    ...(params.linkURL ? { linkUrl: params.linkURL } : {}),
    ...(params.srcURL ? { srcUrl: params.srcURL } : {}),
    ...(params.pageURL ? { pageUrl: params.pageURL } : {}),
    ...(params.frameURL ? { frameUrl: params.frameURL } : {}),
    ...(params.selectionText ? { selectionText: params.selectionText } : {}),
    editable: params.isEditable,
    wasChecked: item.checked ?? false,
    checked
  }
}

function tabFor(profileId: string, webContentsId: number): Record<string, unknown> | undefined {
  const entry = extensionTabEntries(profileId).find(
    (candidate) => candidate.webContentsId === webContentsId
  )
  return entry ? (asExtensionTab(entry) as unknown as Record<string, unknown>) : undefined
}

function templateFor(
  profileId: string,
  extensionId: string,
  items: MenuItemRecord[],
  contexts: string[],
  parentId: string | undefined,
  params: ContextMenuParams,
  webContents: WebContents
): MenuItemConstructorOptions[] {
  return items
    .filter((item) => item.parentId === parentId && item.visible !== false)
    .filter((item) => matchesContexts(item, contexts))
    .map((item) => {
      const common: MenuItemConstructorOptions = {
        label: item.title ?? item.id,
        type: item.type ?? 'normal'
      }
      if (item.type === 'separator') return { type: 'separator' }
      common.enabled = item.disabled === true ? false : item.enabled !== false
      if (item.type === 'checkbox' || item.type === 'radio') {
        common.checked = item.checked === true
      }
      const children = templateFor(
        profileId,
        extensionId,
        items,
        contexts,
        item.id,
        params,
        webContents
      )
      if (children.length > 0) common.submenu = children
      common.click = (menuItem: MenuItem) => {
        const checked = menuItem.checked
        if (item.type === 'checkbox' || item.type === 'radio') {
          const current = readItems(profileId, extensionId)
          const stored = current.find((candidate) => candidate.id === item.id)
          if (stored) {
            stored.checked = checked
            if (item.type === 'radio') {
              for (const sibling of current) {
                if (
                  sibling.id !== item.id &&
                  sibling.parentId === item.parentId &&
                  sibling.type === 'radio'
                ) {
                  sibling.checked = false
                }
              }
            }
            writeItems(profileId, extensionId, current)
          }
        }
        const tab = tabFor(profileId, webContents.id)
        broadcastExtensionApiEvent(
          profileId,
          {
            path: ['contextMenus'],
            event: 'onClicked',
            args: [clickInfo(params, item, checked), tab],
            extensionId
          },
          'contextMenus'
        )
      }
      return common
    })
}

/** Attach extension context menus to every webContents in one profile. */
export function attachContextMenus(ses: Session, profileId: string): void {
  if (attached.has(ses)) return
  attached.add(ses)

  const attach = (webContents: WebContents): void => {
    if (watched.has(webContents)) return
    watched.add(webContents)
    webContents.on('context-menu', (_event, params) => {
      const contexts = actualContexts(params, webContents)
      const template: MenuItemConstructorOptions[] = []
      for (const extension of ses.extensions.getAllExtensions()) {
        const extensionId = extension.id
        const items = readItems(profileId, extensionId)
        if (items.length === 0) continue
        const menuItems = templateFor(
          profileId,
          extensionId,
          items,
          contexts,
          undefined,
          params,
          webContents
        )
        if (menuItems.length === 0) continue
        template.push(
          { label: extension.name, enabled: false },
          { type: 'separator' },
          ...menuItems
        )
      }
      if (template.length === 0) return
      Menu.buildFromTemplate(template).popup()
    })
  }

  for (const contents of electronWebContents.getAllWebContents()) {
    if (contents.session === ses) attach(contents)
  }
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session === ses) attach(contents)
  })
}

export function registerContextMenus(): void {
  registerExtensionApiHandler('contextMenus', {
    permissions: ['contextMenus'],
    invoke(context, method, args): unknown {
      const items = readItems(context.profileId, context.extensionId)
      const save = (): void => writeItems(context.profileId, context.extensionId, items)

      if (method === 'create') {
        const provided =
          typeof args[0] === 'string' || typeof args[0] === 'number' ? String(args[0]) : ''
        const properties = record(typeof args[0] === 'object' ? args[0] : args[1])
        const id = provided || `${Date.now()}-${(nextId += 1)}`
        if (items.some((item) => item.id === id)) throw new Error(`Menu item ${id} already exists`)
        items.push(normalizeItem(id, properties))
        save()
        return id
      }
      if (method === 'update') {
        const id = String(args[0] ?? '')
        const item = items.find((candidate) => candidate.id === id)
        if (!item) throw new Error(`Menu item ${id} was not found`)
        const patch = normalizeItem(id, record(args[1]), item.parentId)
        Object.assign(item, patch, { id })
        save()
        return undefined
      }
      if (method === 'remove') {
        const id = String(args[0] ?? '')
        const index = items.findIndex((item) => item.id === id)
        if (index >= 0) {
          items.splice(index, 1)
          for (const item of items) if (item.parentId === id) delete item.parentId
          save()
        }
        broadcastExtensionApiEvent(
          context.profileId,
          { path: ['contextMenus'], event: 'onRemoved', args: [id] },
          'contextMenus'
        )
        return undefined
      }
      if (method === 'removeAll') {
        writeItems(context.profileId, context.extensionId, [])
        return undefined
      }
      if (method === 'getAll') {
        return items.map((item) => ({ ...item }))
      }
      throw new Error(`chrome.contextMenus.${method} is not supported.`)
    }
  })
}
