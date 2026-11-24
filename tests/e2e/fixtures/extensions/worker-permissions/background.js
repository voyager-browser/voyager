const reportPermission = async () => {
  const granted = await chrome.permissions.contains({ permissions: ['nativeMessaging'] })
  const url = `https://example.test/?worker-permission=${granted}`

  // The extension is loaded before the first browser window is shown, so keep
  // retrying until the chrome UI can host the tab.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tab = await chrome.tabs.create({ url })
    if (tab && tab.id) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

void reportPermission()
