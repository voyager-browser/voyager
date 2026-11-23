const tabsResult = document.getElementById('tabs-result')
const permissionResult = document.getElementById('permission-result')
const nativeResult = document.getElementById('native-result')
const nativePortResult = document.getElementById('native-port-result')

document.getElementById('open-tab')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://example.test/' }, (tab) => {
    if (tabsResult) tabsResult.textContent = tab && tab.id ? 'tab opened' : 'no tab'
  })
})

document.getElementById('request-permission')?.addEventListener('click', () => {
  chrome.permissions.request({ permissions: ['privacy'] }, (granted) => {
    if (permissionResult) permissionResult.textContent = granted ? 'permission granted' : 'denied'
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
