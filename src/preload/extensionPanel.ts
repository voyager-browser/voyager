/**
 * Preload for extension-owned documents shown in an in-window panel.
 *
 * Extension pages get the Chrome API shim from the session-level
 * `extensionCompat` preload. They must never receive Voyager's browser
 * management bridge, so this entry intentionally exposes nothing to the page.
 * It only forwards Escape from the renderer: Playwright's synthetic keys go
 * straight to the DOM and do not reach Electron's `before-input-event` hook.
 */
import { ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    void ipcRenderer.invoke(IpcChannels.ExtensionPanelDismiss).catch(() => undefined)
  },
  true
)
