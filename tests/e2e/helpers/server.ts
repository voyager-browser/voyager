import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

export interface RequestRecord {
  path: string
  query: URLSearchParams
  at: number
}

export interface TestServer {
  origin: string
  url(path: string): string
  requests: RequestRecord[]
  hits(path: string): number
  reset(): void
  close(): Promise<void>
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>${body}</body>
</html>`
}

function sendHtml(res: ServerResponse, body: string): void {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(body)
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const home = document(
  'Voyager Test Home',
  `<h1 id="heading">Test Home</h1>
  <p id="copy">Welcome to the Voyager test page.</p>
  <a id="to-second" href="/second">Go to second</a>
  <a id="open-popup" href="/popup" target="_blank">Open popup</a>
  <button id="open-window" type="button">Open window</button>
  <a id="to-settings" href="voyager://settings">Open settings</a>
  <a id="download" href="/download?name=voyager-test.txt">Download file</a>
  <a id="download-slow" href="/download-slow?name=voyager-slow.txt">Download large file</a>
  <script>
    document.getElementById('open-window').addEventListener('click', () => {
      window.open('/popup', '_blank')
    })
  </script>`
)

const second = document(
  'Second Page',
  `<h1 id="heading">Second Page</h1>
  <a id="to-home" href="/home">Back home</a>`
)

const popup = document('Popup Page', '<h1 id="heading">Popup Page</h1>')

const permissionsPage = document(
  'Permissions Page',
  `<h1 id="heading">Permission Test Page</h1>
  <button id="request-location" type="button">Ask for location</button>
  <button id="request-camera" type="button">Ask for camera</button>
  <button id="request-notifications" type="button">Ask for notifications</button>
  <p id="permission-result">No request made</p>
  <script>
    const result = document.getElementById('permission-result')
    document.getElementById('request-location').addEventListener('click', () => {
      result.textContent = 'Location requested'
      navigator.geolocation.getCurrentPosition(
        () => { result.textContent = 'Location allowed' },
        (error) => { result.textContent = 'Location failed:' + error.code }
      )
    })
    document.getElementById('request-camera').addEventListener('click', () => {
      result.textContent = 'Camera requested'
      navigator.mediaDevices.getUserMedia({ video: true }).then(
        (stream) => {
          result.textContent = 'Camera allowed'
          stream.getTracks().forEach((track) => track.stop())
        },
        (error) => { result.textContent = 'Camera failed:' + error.name }
      )
    })
    document.getElementById('request-notifications').addEventListener('click', () => {
      result.textContent = 'Notifications requested'
      Notification.requestPermission().then((permission) => {
        result.textContent = 'Notifications:' + permission
      })
    })
  </script>`
)

const promptPage = document(
  'Prompt Test Page',
  `<h1 id="heading">Prompt Test Page</h1>
  <button id="plain-prompt" type="button">Ask plain</button>
  <button id="default-prompt" type="button">Ask with default</button>
  <p id="prompt-result">No prompt yet</p>
  <script>
    const result = document.getElementById('prompt-result')
    const record = (value) => {
      result.textContent = value === null ? 'cancelled' : 'answer:' + value
    }
    document.getElementById('plain-prompt').addEventListener('click', () => {
      record(window.prompt('What is your name?'))
    })
    document.getElementById('default-prompt').addEventListener('click', () => {
      record(window.prompt('Rename this item', 'Untitled'))
    })
  </script>`
)

const findPage = document(
  'Find Page',
  `<h1 id="heading">Find Page</h1>
  <p class="needle">needle one</p>
  <p class="needle">needle two</p>
  <p class="needle">needle three</p>
  <p>Nothing to see here.</p>`
)

async function handle(req: URL, res: ServerResponse, counts: Map<string, number>): Promise<void> {
  const path = req.pathname
  counts.set(path, (counts.get(path) ?? 0) + 1)

  if (path === '/' || path === '/home') {
    sendHtml(res, home)
    return
  }
  if (path === '/second') {
    sendHtml(res, second)
    return
  }
  if (path === '/popup') {
    sendHtml(res, popup)
    return
  }
  if (path === '/find') {
    sendHtml(res, findPage)
    return
  }
  if (path === '/prompt') {
    sendHtml(res, promptPage)
    return
  }
  if (path === '/permissions') {
    sendHtml(res, permissionsPage)
    return
  }
  if (path === '/search') {
    const query = req.searchParams.get('q') ?? ''
    sendHtml(
      res,
      document(
        'Search Results',
        `<h1 id="query">${escapeHtml(query)}</h1><p>Results for the query above.</p>`
      )
    )
    return
  }
  if (path === '/suggest') {
    sendJson(res, [['alpha suggestion', 'beta suggestion']])
    return
  }
  if (path === '/count') {
    const hits = counts.get('/count') ?? 0
    sendHtml(res, document('Count Page', `<h1 id="hits">${hits}</h1>`))
    return
  }
  if (path === '/slow') {
    const ms = Math.min(Number(req.searchParams.get('ms') ?? 3000), 10_000)
    await delay(ms)
    if (!res.destroyed) sendHtml(res, document('Slow Page', '<h1 id="heading">Slow Page</h1>'))
    return
  }
  if (path === '/redirect') {
    res.statusCode = 302
    res.setHeader('location', '/second')
    res.end()
    return
  }
  if (path === '/download') {
    const filename = req.searchParams.get('name') ?? 'voyager-test.txt'
    const body = Buffer.from('voyager download payload\n')
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-disposition', `attachment; filename="${filename}"`)
    res.setHeader('content-length', String(body.byteLength))
    res.end(body)
    return
  }
  if (path === '/download-slow') {
    const filename = req.searchParams.get('name') ?? 'voyager-slow.txt'
    const chunk = Buffer.alloc(16 * 1024, 'x')
    const chunks = 80
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-disposition', `attachment; filename="${filename}"`)
    res.setHeader('content-length', String(chunk.byteLength * chunks))
    for (let index = 0; index < chunks; index += 1) {
      if (res.destroyed) return
      res.write(chunk)
      await delay(50)
    }
    res.end()
    return
  }
  if (path === '/favicon.ico') {
    res.statusCode = 204
    res.end()
    return
  }

  res.statusCode = 404
  sendHtml(res, document('Not Found', '<h1 id="heading">Not Found</h1>'))
}

export async function startTestServer(): Promise<TestServer> {
  const requests: RequestRecord[] = []
  const counts = new Map<string, number>()

  const server = createServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
    requests.push({ path: parsed.pathname, query: parsed.searchParams, at: Date.now() })
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('cache-control', 'no-store')
    try {
      await handle(parsed, res, counts)
    } catch (error) {
      if (!res.headersSent) res.statusCode = 500
      if (!res.writableEnded) res.end(String(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`

  return {
    origin,
    url: (path: string) => `${origin}${path.startsWith('/') ? path : `/${path}`}`,
    requests,
    hits: (path: string) => requests.filter((record) => record.path === path).length,
    reset: () => {
      requests.length = 0
      counts.clear()
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
