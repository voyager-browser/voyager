const openCount = Number(localStorage.getItem('popupOpenCount') ?? 0) + 1
localStorage.setItem('popupOpenCount', String(openCount))
const popupCount = document.getElementById('popup-open-count')
if (popupCount) popupCount.textContent = String(openCount)

const optionsResult = document.getElementById('options-result')
const tabsResult = document.getElementById('tabs-result')
const permissionResult = document.getElementById('permission-result')
const privacyResult = document.getElementById('privacy-result')
const nativeResult = document.getElementById('native-result')
const nativePortResult = document.getElementById('native-port-result')

document.getElementById('request-popup')?.addEventListener('click', () => {
  void chrome.action.openPopup()
})

document.getElementById('open-tab')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://example.test/' }, (tab) => {
    if (tabsResult) tabsResult.textContent = tab && tab.id ? 'tab opened' : 'no tab'
  })
})

document.getElementById('probe-tabs')?.addEventListener('click', async () => {
  const result = document.getElementById('tabs-probe-result')
  const tabs = await chrome.tabs.query({})
  const target = tabs.find((tab) => tab.url?.includes('/second'))
  const removable = tabs.find((tab) => tab.url?.includes('/third'))
  if (!target) {
    if (result) result.textContent = 'no target tab'
    return
  }
  const updated = await chrome.tabs.update(target.id, { pinned: true })
  await chrome.tabs.move(target.id, { index: 0 })
  await chrome.tabs.setZoom(target.id, 1.25)
  const zoom = await chrome.tabs.getZoom(target.id)
  const first = (await chrome.tabs.query({ index: 0 }))[0]
  const removed = removable ? await chrome.tabs.remove(removable.id) : false
  if (result) {
    result.textContent = JSON.stringify({
      count: tabs.length,
      pinned: updated?.pinned === true,
      firstMoved: first?.id === target.id,
      zoomApplied: Math.abs(zoom - 1.25) < 0.001,
      removed
    })
  }
})

document.getElementById('open-options')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage((opened) => {
    if (optionsResult) {
      optionsResult.textContent = opened ? 'settings opened' : 'no settings page'
    }
  })
})

document.getElementById('request-permission')?.addEventListener('click', () => {
  chrome.permissions.request({ permissions: ['privacy'] }, (granted) => {
    if (permissionResult) permissionResult.textContent = granted ? 'permission granted' : 'denied'
  })
})

document.getElementById('set-privacy')?.addEventListener('click', () => {
  chrome.privacy.services.passwordSavingEnabled.set({ value: false }, () => {
    if (privacyResult) {
      privacyResult.textContent = chrome.runtime.lastError
        ? 'privacy blocked'
        : 'password saving off'
    }
  })
})

document.getElementById('send-native')?.addEventListener('click', () => {
  chrome.runtime.sendNativeMessage('com.voyager.e2e', { ping: 'one-shot' }, (response) => {
    if (nativeResult) nativeResult.textContent = response?.echo ?? 'no native reply'
  })
})

document.getElementById('connect-native')?.addEventListener('click', () => {
  const port = chrome.runtime.connectNative('com.voyager.e2e')
  port.onMessage.addListener((message) => {
    if (nativePortResult) nativePortResult.textContent = message.echo ?? 'no port reply'
    port.disconnect()
  })
  port.postMessage({ ping: 'port' })
})
