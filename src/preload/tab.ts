import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

const PROMPT_BRIDGE = '__voyagerPrompt'

// A small synchronous bridge the page-world prompt override can call. The tab
// renderer stays blocked inside sendSync until the chrome UI answers.
contextBridge.exposeInMainWorld(PROMPT_BRIDGE, (message: string, defaultValue: string) =>
  ipcRenderer.sendSync(IpcChannels.TabPrompt, { message, defaultValue })
)

// WebAuthn/passkey bridge (macOS uses native AuthenticationServices via the
// main process). Exposed to the page world so the navigator.credentials wrapper
// can invoke it; other platforms keep Chromium's native WebAuthn.
if (process.platform === 'darwin') {
  contextBridge.exposeInMainWorld('__voyagerWebAuthn', {
    create: (payload: { options?: unknown; origin: string; topOrigin?: string }) =>
      ipcRenderer.invoke(IpcChannels.WebAuthnCreate, payload),
    get: (payload: { options?: unknown; origin: string; topOrigin?: string }) =>
      ipcRenderer.invoke(IpcChannels.WebAuthnGet, payload)
  })
}

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

    // macOS: route WebAuthn publicKey operations through native AuthenticationServices
    // (supports platform passkeys, security keys, and cross-device QR). Other platforms
    // use Chromium's native implementation.
    if (${JSON.stringify(process.platform === 'darwin')} && window.__voyagerWebAuthn && navigator.credentials) {
      const b64uToBuf = (s) => {
        if (s == null) return null;
        if (s instanceof ArrayBuffer) return s;
        if (ArrayBuffer.isView(s)) return s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength);
        if (typeof s !== 'string') return s;
        const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
      };
      const bufToB64u = (buf) => {
        if (buf == null) return null;
        const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      };
      const toCredError = (err, fallback) => {
        const name = (err && err.error) || fallback || 'NotAllowedError';
        const msg = (err && (err.message || (err.errorObject && err.errorObject.message))) || String(name);
        try { return new DOMException(msg, name); } catch { return new Error(msg); }
      };
      const buildGetCredential = (d) => {
        const rawId = b64uToBuf(d.credentialId);
        const response = {
          clientDataJSON: b64uToBuf(d.clientDataJSON),
          authenticatorData: b64uToBuf(d.authenticatorData),
          signature: b64uToBuf(d.signature),
          userHandle: b64uToBuf(d.userHandle),
          getAuthenticatorData() { return this.authenticatorData; },
          getPublicKey() { return null; },
          getPublicKeyAlgorithm() { return -7; },
          getTransports() { return []; },
          toJSON() { return { clientDataJSON: bufToB64u(this.clientDataJSON), authenticatorData: bufToB64u(this.authenticatorData), signature: bufToB64u(this.signature), userHandle: this.userHandle ? bufToB64u(this.userHandle) : null }; }
        };
        return {
          id: typeof d.credentialId === 'string' ? d.credentialId : bufToB64u(rawId),
          rawId, type: 'public-key',
          authenticatorAttachment: d.authenticatorAttachment || 'platform',
          response,
          getClientExtensionResults() { return d.extensions || {}; },
          toJSON() { return { id: this.id, rawId: bufToB64u(this.rawId), type: this.type, authenticatorAttachment: this.authenticatorAttachment, response: this.response.toJSON(), clientExtensionResults: this.getClientExtensionResults() }; }
        };
      };
      const buildCreateCredential = (d) => {
        const rawId = b64uToBuf(d.credentialId);
        const response = {
          clientDataJSON: b64uToBuf(d.clientDataJSON),
          attestationObject: b64uToBuf(d.attestationObject),
          getAuthenticatorData() { return b64uToBuf(d.authData); },
          getPublicKey() { return b64uToBuf(d.publicKey); },
          getPublicKeyAlgorithm() { return d.publicKeyAlgorithm ?? -7; },
          getTransports() { return Array.isArray(d.transports) ? d.transports : []; },
          toJSON() { return { clientDataJSON: bufToB64u(this.clientDataJSON), attestationObject: bufToB64u(this.attestationObject), authenticatorData: bufToB64u(b64uToBuf(d.authData)), publicKey: bufToB64u(b64uToBuf(d.publicKey)), publicKeyAlgorithm: this.getPublicKeyAlgorithm(), transports: this.getTransports() }; }
        };
        return {
          id: typeof d.credentialId === 'string' ? d.credentialId : bufToB64u(rawId),
          rawId, type: 'public-key',
          authenticatorAttachment: d.authenticatorAttachment || 'platform',
          response,
          getClientExtensionResults() { return d.extensions || {}; },
          toJSON() { return { id: this.id, rawId: bufToB64u(this.rawId), type: this.type, authenticatorAttachment: this.authenticatorAttachment, response: this.response.toJSON(), clientExtensionResults: this.getClientExtensionResults() }; }
        };
      };
      const orig = navigator.credentials;
      const wrap = {
        async create(options) {
          if (!options || !options.publicKey) return orig.create(options);
          const result = await window.__voyagerWebAuthn.create({ options: options.publicKey, origin: location.origin, topOrigin: (()=>{try{return top.location.origin}catch{return undefined}})() });
          if (result && result.success && result.data) return buildCreateCredential(result.data);
          throw toCredError(result, 'NotAllowedError');
        },
        async get(options) {
          if (!options || !options.publicKey) return orig.get(options);
          // Conditional mediation and abort signals have special semantics; keep native
          // behavior when the bridge can't faithfully represent them.
          if (options.mediation === 'conditional') return orig.get(options);
          if (options.signal && options.signal.aborted) throw toCredError({ error: 'AbortError' }, 'AbortError');
          const result = await window.__voyagerWebAuthn.get({ options: options.publicKey, origin: location.origin, topOrigin: (()=>{try{return top.location.origin}catch{return undefined}})() });
          if (result && result.success && result.data) return buildGetCredential(result.data);
          if (result && result.error === 'AbortError') throw toCredError(result, 'AbortError');
          throw toCredError(result, 'NotAllowedError');
        },
        store: orig.store ? orig.store.bind(orig) : undefined,
        preventSilentAccess: orig.preventSilentAccess ? orig.preventSilentAccess.bind(orig) : undefined
      };
      try { Object.defineProperty(navigator, 'credentials', { configurable: true, get: () => wrap }); } catch {}
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

/* ---- autofill/form history (best-effort MVP, #139) ---------------------- */

type TextControl = HTMLInputElement | HTMLTextAreaElement

function isTextControl(el: Element | null): el is TextControl {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (!(el instanceof HTMLInputElement)) return false
  if (el.disabled || el.readOnly) return false
  const t = (el.type || 'text').toLowerCase()
  return ['text', 'search', 'email', 'tel', 'url', 'number', ''].includes(t)
}

function acToken(el: TextControl): string {
  const raw = (el.getAttribute('autocomplete') || '').toLowerCase().trim()
  if (!raw || raw === 'on' || raw === 'off') return ''
  const parts = raw.split(/\s+/)
  return parts[parts.length - 1] || ''
}

function fieldKey(el: TextControl): string {
  const ac = acToken(el)
  if (ac) return ac
  return el.name || el.id || el.getAttribute('aria-label') || 'field'
}

function shouldSaveHistory(el: TextControl): boolean {
  const ac = acToken(el)
  if (/(password|new-password|current-password|one-time-code|cc-csc|cc-cvv)/.test(ac)) return false
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'password') return false
  const key = fieldKey(el).toLowerCase()
  if (/password|cvv|cvc|csc|secret|token|otp/.test(key)) return false
  return true
}

const ADDRESS_TOKENS = new Set(['name','given-name','family-name','honorific-prefix','email','tel','organization','street-address','address-line1','address-line2','address-level2','address-level1','postal-code','country','country-name'])
const PAYMENT_TOKENS = new Set(['cc-name','cc-number','cc-exp','cc-exp-month','cc-exp-year','cc-type'])

function fillKind(el: TextControl): 'address' | 'contact' | 'payment' | null {
  const t = acToken(el)
  if (PAYMENT_TOKENS.has(t)) return 'payment'
  if (ADDRESS_TOKENS.has(t)) return (t === 'email' || t === 'tel' || t === 'organization') && !/(address|postal|country|street|level)/.test(t) ? 'contact' : 'address'
  const key = fieldKey(el).toLowerCase()
  if (/card.?number|cc.?num/.test(key)) return 'payment'
  if (/expir|cc.?exp/.test(key)) return 'payment'
  return null
}

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let listEl: HTMLDivElement | null = null
let activeControl: TextControl | null = null
let suggestTimer: number | null = null

function ensureHost(): { list: HTMLDivElement } {
  if (host && shadow && listEl && host.isConnected) return { list: listEl }
  host = document.createElement('div')
  host.id = 'voyager-autofill-host'
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:0;height:0;'
  shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    .box{position:fixed;min-width:180px;max-width:min(420px,90vw);max-height:240px;overflow:auto;
      background:#fff;color:#111;border:1px solid rgba(0,0,0,.15);border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.3 system-ui,-apple-system,sans-serif;padding:4px}
    @media (prefers-color-scheme: dark){.box{background:#1f1f23;color:#f3f3f5;border-color:rgba(255,255,255,.14)} .item:hover{background:rgba(255,255,255,.08)} .hdr{color:#a9a9b2}}
    .hdr{padding:4px 9px;font-size:11px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.02em}
    .item{padding:7px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .item:hover{background:rgba(0,0,0,.06)}
  `
  listEl = document.createElement('div')
  listEl.className = 'box'
  listEl.style.display = 'none'
  shadow.append(style, listEl)
  ;(document.documentElement || document.body).appendChild(host)
  return { list: listEl }
}

function hideSuggestions(): void {
  if (listEl) listEl.style.display = 'none'
  activeControl = null
}

function placeBox(control: TextControl): void {
  if (!listEl) return
  const rect = control.getBoundingClientRect()
  listEl.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 220))}px`
  listEl.style.top = `${Math.min(window.innerHeight - 60, rect.bottom + 4)}px`
  listEl.style.minWidth = `${Math.max(180, Math.min(rect.width, 420))}px`
}

function setValue(control: TextControl, value: string): void {
  control.focus()
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

function controlsInScope(control: TextControl): TextControl[] {
  const root = control.form ?? document
  return Array.from(root.querySelectorAll('input,textarea')).filter((el): el is TextControl => isTextControl(el))
}

function fillAddressForm(control: TextControl, a: Record<string, any>): void {
  for (const el of controlsInScope(control)) {
    const t = acToken(el)
    const map: Record<string, string> = {
      name: a.name, 'given-name': (a.name || '').split(/\s+/)[0] || '', 'family-name': (a.name || '').split(/\s+/).slice(1).join(' ') || '',
      email: a.email, tel: a.phone, organization: a.organization,
      'street-address': [a.streetAddress, a.streetAddress2].filter(Boolean).join(', '), 'address-line1': a.streetAddress, 'address-line2': a.streetAddress2,
      'address-level2': a.city, 'address-level1': a.region, 'postal-code': a.postalCode, country: a.country, 'country-name': a.country
    }
    if (t && map[t] !== undefined && map[t] !== '') setValue(el, String(map[t]))
  }
}

function fillContactForm(control: TextControl, c: Record<string, any>): void {
  for (const el of controlsInScope(control)) {
    const t = acToken(el)
    const map: Record<string, string> = { name: c.name, email: c.email, tel: c.phone, organization: c.organization }
    if (t && map[t] !== undefined && map[t] !== '') setValue(el, String(map[t]))
  }
}

function fillPaymentForm(control: TextControl, p: Record<string, any>): void {
  for (const el of controlsInScope(control)) {
    const t = acToken(el)
    const key = fieldKey(el).toLowerCase()
    if (t === 'cc-name' || /card.?name|name.?card/.test(key)) setValue(el, String(p.nameOnCard || ''))
    else if (t === 'cc-number' || /card.?number|cc.?num/.test(key)) setValue(el, String(p.cardNumber || ''))
    else if (t === 'cc-exp-month' || /exp.*month|month.*exp/.test(key)) setValue(el, String(p.expiryMonth || ''))
    else if (t === 'cc-exp-year' || /exp.*year|year.*exp/.test(key)) setValue(el, String(p.expiryYear || ''))
    else if (t === 'cc-exp' || /^exp/.test(key)) {
      const mm = String(p.expiryMonth || '').padStart(2, '0')
      const yy = String(p.expiryYear || '').slice(-2)
      if (mm && yy) setValue(el, `${mm}/${yy}`)
    }
  }
}

function addHeader(list: HTMLDivElement, text: string): void {
  const h = document.createElement('div')
  h.className = 'hdr'
  h.textContent = text
  list.appendChild(h)
}

function addItem(list: HTMLDivElement, label: string, onPick: () => void): void {
  const item = document.createElement('div')
  item.className = 'item'
  item.textContent = label
  item.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(); hideSuggestions() })
  list.appendChild(item)
}

async function refreshSuggestions(control: TextControl): Promise<void> {
  if (!isTextControl(control)) { hideSuggestions(); return }
  const { list } = ensureHost()
  activeControl = control
  list.replaceChildren()
  let has = false
  try {
    const kind = fillKind(control)
    if (kind) {
      const profiles = (await ipcRenderer.invoke(IpcChannels.AutofillGetFillData, { kind })) as Array<Record<string, any>>
      if (Array.isArray(profiles) && profiles.length > 0 && (activeControl === control || document.activeElement === control)) {
        addHeader(list, kind === 'payment' ? 'Payment methods' : kind === 'contact' ? 'Contacts' : 'Addresses')
        for (const p of profiles.slice(0, 6)) {
          const label = kind === 'payment'
            ? `${p.nameOnCard || 'Card'} •••• ${String(p.cardNumber || '').replace(/\s+/g, '').slice(-4)}`
            : kind === 'contact'
              ? `${p.name || 'Contact'}${p.email ? ` — ${p.email}` : ''}`
              : `${p.name || 'Address'} — ${[p.streetAddress, p.city].filter(Boolean).join(', ')}`
          addItem(list, label, () => {
            if (kind === 'payment') fillPaymentForm(control, p)
            else if (kind === 'contact') fillContactForm(control, p)
            else fillAddressForm(control, p)
          })
        }
        has = true
      }
    }
    if (shouldSaveHistory(control) && (activeControl === control || document.activeElement === control)) {
      const values = (await ipcRenderer.invoke(IpcChannels.AutofillGetFormSuggestions, {
        field: fieldKey(control), prefix: control.value ?? ''
      })) as string[]
      if (Array.isArray(values) && values.length > 0) {
        if (has) addHeader(list, 'Form history')
        for (const v of values) addItem(list, v, () => setValue(control, v))
        has = true
      }
    }
  } catch { /* ignore */ }
  if (!has || (activeControl !== control && document.activeElement !== control)) { hideSuggestions(); return }
  placeBox(control)
  list.style.display = 'block'
}

function scheduleSuggestions(control: TextControl): void {
  if (suggestTimer !== null) window.clearTimeout(suggestTimer)
  suggestTimer = window.setTimeout(() => void refreshSuggestions(control), 120)
}

function recordControl(control: TextControl): void {
  if (!isTextControl(control) || !shouldSaveHistory(control)) return
  const value = control.value?.trim()
  if (!value) return
  void ipcRenderer.invoke(IpcChannels.AutofillRecordFormField, { field: fieldKey(control), value })
}

document.addEventListener('focusin', (e) => { const t = e.target; if (t instanceof Element && isTextControl(t)) scheduleSuggestions(t) }, true)
document.addEventListener('input', (e) => { const t = e.target; if (t instanceof Element && isTextControl(t)) scheduleSuggestions(t) }, true)
document.addEventListener('focusout', (e) => {
  const t = e.target
  if (t instanceof Element && isTextControl(t)) {
    recordControl(t)
    window.setTimeout(() => { if (activeControl === t) hideSuggestions() }, 150)
  }
}, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggestions() }, true)
document.addEventListener('submit', (e) => {
  const form = e.target
  if (!(form instanceof HTMLFormElement)) return
  for (const el of Array.from(form.elements)) {
    if (el instanceof Element && isTextControl(el)) recordControl(el)
  }
}, true)
