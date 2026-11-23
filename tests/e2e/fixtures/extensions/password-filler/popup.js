const tabsResult = document.getElementById('tabs-result')

document.getElementById('open-tab')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://example.test/' }, (tab) => {
    if (tabsResult) tabsResult.textContent = tab && tab.id ? 'tab opened' : 'no tab'
  })
})
