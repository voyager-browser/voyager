import { BrowserWindow, type Session } from 'electron'
import { permissionOriginForUrl } from '../../shared/permissions'
import { getSettings } from '../store'
import { storesFor } from '../store'

const MAX_TOP_SITES = 5
const PRELOAD_TIMEOUT_MS = 15_000

function topSiteUrls(profileId: string): string[] {
  const entries = storesFor(profileId).history.get('entries') ?? []
  const byOrigin = new Map<string, { url: string; score: number; visitedAt: number }>()
  for (const entry of entries) {
    if (!entry?.url || !/^https?:\/\//i.test(entry.url)) continue
    const origin = permissionOriginForUrl(entry.url)
    if (!origin) continue
    const score = typeof entry.visitCount === 'number' ? entry.visitCount : 1
    const visitedAt = typeof entry.visitedAt === 'number' ? entry.visitedAt : 0
    const existing = byOrigin.get(origin)
    if (!existing || score > existing.score || (score === existing.score && visitedAt > existing.visitedAt)) {
      byOrigin.set(origin, { url: origin + '/', score, visitedAt })
    }
  }
  return [...byOrigin.values()]
    .sort((a, b) => b.score - a.score || b.visitedAt - a.visitedAt)
    .slice(0, MAX_TOP_SITES)
    .map((item) => item.url)
}

async function resolveHosts(ses: Session, urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const host = new URL(url).hostname
        if ('resolveHost' in ses && typeof (ses as any).resolveHost === 'function') {
          await (ses as any).resolveHost(host)
        }
      } catch {
        /* ignore */
      }
    })
  )
}

async function preloadUrl(ses: Session, url: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true
    }
  })
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PRELOAD_TIMEOUT_MS))
    ])
  } catch {
    /* ignore preload failures */
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const inFlight = new Set<string>()

export async function runTopSitesPreload(ses: Session, profileId: string): Promise<void> {
  if (getSettings(profileId, 'preloadTopSites', false) !== true) return
  if (inFlight.has(profileId)) return
  inFlight.add(profileId)
  try {
    const urls = topSiteUrls(profileId)
    if (urls.length === 0) return
    await resolveHosts(ses, urls)
    for (const url of urls) {
      if (getSettings(profileId, 'preloadTopSites', false) !== true) break
      await preloadUrl(ses, url)
    }
  } finally {
    inFlight.delete(profileId)
  }
}
