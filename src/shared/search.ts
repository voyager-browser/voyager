/** Search-engine backends: URL template + suggestion endpoint per engine. */
export const SEARCH_ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    search: (query: string): string => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    suggest: (partial: string): string =>
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(partial)}&type=list`
  },
  google: {
    name: 'Google',
    search: (query: string): string =>
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    suggest: (partial: string): string =>
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(partial)}`
  },
  brave: {
    name: 'Brave Search',
    search: (query: string): string =>
      `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    suggest: (partial: string): string =>
      `https://search.brave.com/api/suggest?q=${encodeURIComponent(partial)}`
  },
  bing: {
    name: 'Bing',
    search: (query: string): string =>
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    suggest: (partial: string): string =>
      `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(partial)}`
  },
  ecosia: {
    name: 'Ecosia',
    search: (query: string): string =>
      `https://www.ecosia.org/search?q=${encodeURIComponent(query)}`,
    suggest: (partial: string): string =>
      `https://ac.ecosia.org/autocomplete?q=${encodeURIComponent(partial)}&type=list`
  }
} as const

export type SearchEngineId = keyof typeof SEARCH_ENGINES

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'duckduckgo'

/** Type guard for values arriving over IPC. */
export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return typeof value === 'string' && value in SEARCH_ENGINES
}

export function buildSearchUrl(engine: SearchEngineId, query: string): string {
  return SEARCH_ENGINES[engine].search(query)
}

/** Extract suggestion strings from a suggest-endpoint response body. */
export function parseSuggestions(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  // Some endpoints wrap JSON in a JSONP-style `callback(...)`.
  const inner = trimmed.startsWith('(')
    ? trimmed.slice(1, Math.max(1, trimmed.lastIndexOf(')')))
    : trimmed
  try {
    const data = JSON.parse(inner) as unknown
    if (Array.isArray(data)) {
      const list = data.find(
        (entry): entry is unknown[] => Array.isArray(entry) && typeof entry[0] === 'string'
      )
      if (!list) return []
      return list.filter((item): item is string => typeof item === 'string').slice(0, 6)
    }
    if (data && typeof data === 'object' && 'suggestions' in data) {
      const suggestions = (data as { suggestions?: unknown }).suggestions
      if (Array.isArray(suggestions)) {
        return suggestions
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 6)
      }
    }
    return []
  } catch {
    return []
  }
}
