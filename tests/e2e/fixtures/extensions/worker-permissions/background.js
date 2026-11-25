const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const reportPermission = async () => {
  const url = 'https://example.test/?worker-permission=true'

  // The compatibility preload installs chrome.tabs.create and chrome.permissions
  // after extension bindings appear. Worker startup can beat that injection, so
  // retry until both shims answer instead of reporting a false result once.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chromeApi = globalThis.chrome
    const shimsReady =
      typeof chromeApi?.permissions?.contains === 'function' &&
      typeof chromeApi?.tabs?.create === 'function'
    if (shimsReady) {
      try {
        const granted = await chromeApi.permissions.contains({
          permissions: ['nativeMessaging']
        })
        if (granted) {
          const tab = await chromeApi.tabs.create({ url })
          if (tab && tab.id) return
        }
      } catch {
        // A handler can disappear while the worker is starting; retry below.
      }
    }
    await delay(50)
  }
}

void reportPermission()
