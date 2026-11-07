import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

const PROMPT_BRIDGE = '__voyagerPrompt'

// A small synchronous bridge the page-world prompt override can call. The tab
// renderer stays blocked inside sendSync until the chrome UI answers.
contextBridge.exposeInMainWorld(PROMPT_BRIDGE, (message: string, defaultValue: string) =>
  ipcRenderer.sendSync(IpcChannels.TabPrompt, { message, defaultValue })
)

// The preload lives in an isolated world, so patch the page's own world to make
// window.prompt() work instead of throwing or returning undefined.
void webFrame.executeJavaScript(`
  (() => {
    Object.defineProperty(window, 'prompt', {
      configurable: true,
      writable: true,
      value: function prompt(message, defaultValue) {
        return window.${PROMPT_BRIDGE}(
          message === undefined ? '' : String(message),
          defaultValue === undefined ? '' : String(defaultValue)
        )
      }
    })
  })()
`)

/**
 * Record the URL of any link being dragged out of the page. The bookmark bar
 * consumes this if the cross-view DataTransfer arrives empty.
 */
window.addEventListener(
  'dragstart',
  (event) => {
    const path = event.composedPath()
    const anchor = path.find(
      (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement
    )
    const url = anchor?.href ?? ''
    if (url.length > 0) ipcRenderer.send(IpcChannels.TabDragStart, url)
  },
  true
)

// Clear the fallback when the drag ends without a drop on the bookmarks bar.
window.addEventListener(
  'dragend',
  () => {
    ipcRenderer.send(IpcChannels.TabDragStart, '')
  },
  true
)
