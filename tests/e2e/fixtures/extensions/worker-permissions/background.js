const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const reportPermission = async () => {
  const url = 'https://example.test/?worker-permission=true'
  let loggedStart = false
  let loggedError = false

  // The compatibility preload installs chrome.tabs.create and chrome.permissions
  // after extension bindings appear. Worker startup can beat that injection, so
  // retry until both shims answer instead of reporting a false result once.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chromeApi = globalThis.chrome
    const shimsReady =
      typeof chromeApi?.permissions?.contains === 'function' &&
      typeof chromeApi?.tabs?.create === 'function'
    if (!loggedStart) {
      console.log(
        '[worker-permissions] start',
        JSON.stringify({
          chrome: typeof chromeApi,
          contains: typeof chromeApi?.permissions?.contains,
          create: typeof chromeApi?.tabs?.create
        })
      )
      loggedStart = true
    }
    if (attempt === 0 || attempt === 50 || attempt === 199) {
      console.log('[worker-permissions] attempt', attempt, 'shimsReady', shimsReady)
    }
    if (shimsReady) {
      try {
        const granted = await chromeApi.permissions.contains({
          permissions: ['nativeMessaging']
        })
        if (granted) {
          const tab = await chromeApi.tabs.create({ url })
          if (tab && tab.id) return
        }
        if (attempt === 0 || attempt % 50 === 0) {
          console.log('[worker-permissions] granted', granted)
        }
      } catch (error) {
        if (!loggedError) {
          console.log('[worker-permissions] permission error', String(error))
          loggedError = true
        }
      }
    }
    await delay(50)
  }
}

void reportPermission()
