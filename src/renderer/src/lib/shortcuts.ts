import { matchShortcut, type BrowserAction } from '../../../shared/keyboard'
import { useBookmarksStore } from '../state/bookmarksStore'
import { useBrowserStore } from '../state/browserStore'
import { useUiStore } from '../state/uiStore'

/** Focus + select the omnibox input. */
export function focusOmnibox(): void {
  const input = document.getElementById('omnibox-input') as HTMLInputElement | null
  input?.focus()
  input?.select()
  window.dispatchEvent(new Event('voyager:focus-omnibox'))
}

function dispatch(action: BrowserAction, index?: number): void {
  const store = useBrowserStore.getState()
  const ui = useUiStore.getState()

  switch (action) {
    case 'new-tab':
      store.createTab()
      break
    case 'close-tab':
      if (store.activeTabId) store.closeTab(store.activeTabId)
      break
    case 'reopen-tab':
      store.reopenTab()
      break
    case 'next-tab':
      store.activateNext()
      break
    case 'prev-tab':
      store.activatePrevious()
      break
    case 'select-tab-n':
      store.activateTabAt((index ?? 1) - 1)
      break
    case 'select-tab-last':
      store.activateTabAt(store.tabs.length - 1)
      break
    case 'focus-omnibox':
      focusOmnibox()
      break
    case 'find-in-page':
      window.dispatchEvent(new Event('voyager:open-find'))
      break
    case 'open-tab-search':
      ui.openTabSearch()
      break
    case 'reload':
      store.reload()
      break
    case 'force-reload':
      store.forceReload()
      break
    case 'stop':
      store.stop()
      break
    case 'dev-tools':
      store.toggleDevTools()
      break
    case 'back':
      store.goBack()
      break
    case 'forward':
      store.goForward()
      break
    case 'toggle-bookmarks-bar':
      useBookmarksStore.getState().toggleBar()
      break
    case 'bookmark-page':
      useBookmarksStore.getState().bookmarkActivePage()
      break
    case 'open-bookmarks-manager':
      useUiStore.getState().openBookmarksManager()
      break
    case 'open-history':
      window.dispatchEvent(new Event('voyager:open-history'))
      break
    case 'open-settings':
      void window.voyager.settings.open()
      break
    case 'open-downloads':
      window.dispatchEvent(new Event('voyager:open-downloads'))
      break
  }
}

/** Handle browser shortcuts while the chrome itself has focus. */
export function installChromeShortcuts(): () => void {
  const platform = window.voyager.platform

  const onKeyDown = (event: KeyboardEvent): void => {
    // Chrome UI (permission prompts, find bar, menus) marks Escape as handled.
    if (event.defaultPrevented) return

    const target = event.target as HTMLElement | null
    const editable =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

    const matched = matchShortcut(
      {
        key: event.key,
        code: event.code,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey
      },
      platform
    )
    if (!matched) return

    // While typing in a field, Escape should close the field, not stop a page.
    if (matched.action === 'stop' && editable) return

    event.preventDefault()
    dispatch(matched.action, matched.index)
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
