const tabsResult = document.getElementById('tabs-result')
const permissionResult = document.getElementById('permission-result')

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
