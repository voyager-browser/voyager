import { permissionOriginForUrl } from '../../../shared/permissions'
import { currentHistoryState } from '../../history/history'
import { registerExtensionApiHandler } from './registry'

const PATH = 'topSites'
const MAX_TOP_SITES = 20

interface SiteGroup {
  origin: string
  title: string
  score: number
  visitedAt: number
}

function requestedLimit(args: unknown[]): number {
  const first = args[0]
  const options =
    first && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {}
  const value = options.maxResults
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_TOP_SITES
  return Math.max(0, Math.min(MAX_TOP_SITES, Math.floor(value)))
}

function readTopSites(profileId: string, limit: number): Array<{ url: string; title: string }> {
  const byOrigin = new Map<string, SiteGroup>()
  for (const entry of currentHistoryState(profileId).entries) {
    const origin = permissionOriginForUrl(entry.url)
    if (!origin) continue
    const score = Number.isFinite(entry.visitCount) ? Math.max(0, entry.visitCount) : 1
    const visitedAt = Number.isFinite(entry.visitedAt) ? entry.visitedAt : 0
    const existing = byOrigin.get(origin)
    if (
      !existing ||
      score > existing.score ||
      (score === existing.score && visitedAt > existing.visitedAt)
    ) {
      byOrigin.set(origin, {
        origin,
        title: entry.title.trim() || origin,
        score,
        visitedAt
      })
    }
  }
  return [...byOrigin.values()]
    .sort(
      (a, b) => b.score - a.score || b.visitedAt - a.visitedAt || a.origin.localeCompare(b.origin)
    )
    .slice(0, limit)
    .map((site) => ({ url: `${site.origin}/`, title: site.title }))
}

export function registerTopSites(): void {
  registerExtensionApiHandler(PATH, {
    permissions: [PATH],
    invoke(context, method, args): unknown {
      if (method === 'get') return readTopSites(context.profileId, requestedLimit(args))
      throw new Error(`chrome.${PATH}.${method} is not supported.`)
    }
  })
}
