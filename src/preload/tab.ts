import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

const PROMPT_BRIDGE = '__voyagerPrompt'

// A small synchronous bridge the page-world prompt override can call. The tab
// renderer stays blocked inside sendSync until the chrome UI answers.
contextBridge.exposeInMainWorld(PROMPT_BRIDGE, (message: string, defaultValue: string) =>
  ipcRenderer.sendSync(IpcChannels.TabPrompt, { message, defaultValue })
)

const CUSTOM_USER_AGENT = (() => {
  try {
    const ua = ipcRenderer.sendSync(IpcChannels.TabGetUserAgent)
    return typeof ua === 'string' ? ua : ''
  } catch {
    return ''
  }
})()

// The preload lives in an isolated world, so patch the page's own world to make
// window.prompt() work instead of throwing or returning undefined, and spoof
// navigator properties when a custom user agent is configured.
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

    const customUA = ${JSON.stringify(CUSTOM_USER_AGENT)};
    if (customUA) {
      const nav = Navigator.prototype;
      const define = (key, value) => {
        try { Object.defineProperty(nav, key, { get: () => value, configurable: true }); } catch {}
      };
      define('userAgent', customUA);
      define('appVersion', customUA.replace(/^Mozilla\\//, ''));
      if (customUA.includes('Windows')) define('platform', 'Win32');
      else if (customUA.includes('Macintosh') || customUA.includes('Mac OS')) define('platform', 'MacIntel');
      else if (customUA.includes('Linux')) define('platform', 'Linux x86_64');

      const mobile = /Mobile|Android|iPhone|iPad/i.test(customUA);
      const chromeMatch = customUA.match(/Chrome\\/([\\d.]+)/);
      const version = chromeMatch ? chromeMatch[1].split('.')[0] : '131';
      const isChromeLike = /Chrome\\//.test(customUA) && !/Edg\\//.test(customUA);
      const platform = /Windows/.test(customUA) ? 'Windows' : /Mac/.test(customUA) ? 'macOS' : /Linux/.test(customUA) ? 'Linux' : 'Unknown';
      const brands = isChromeLike
        ? [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Google Chrome', version }, { brand: 'Chromium', version }]
        : [{ brand: 'Not)A;Brand', version: '99' }];
      const uaData = {
        brands,
        mobile,
        platform,
        getHighEntropyValues: async (hints) => {
          const data = { brands, mobile, platform };
          if (hints && hints.includes('platformVersion')) data.platformVersion = '';
          if (hints && hints.includes('uaFullVersion')) data.uaFullVersion = chromeMatch ? chromeMatch[1] : '';
          if (hints && hints.includes('fullVersionList')) data.fullVersionList = brands.map(b => ({ brand: b.brand, version: b.version + '.0.0.0' }));
          return data;
        },
        toJSON() { return { brands, mobile, platform }; }
      };
      try { Object.defineProperty(nav, 'userAgentData', { get: () => uaData, configurable: true }); } catch {}
    }
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
    const anchor = path.find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
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
