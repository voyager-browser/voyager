import { useState } from 'react'
import { Compass, Search, VenetianMask } from 'lucide-react'
import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINES,
  buildSearchUrl,
  isSearchEngineId
} from '../../../shared/search'

function pageOptions(): { engine: keyof typeof SEARCH_ENGINES; incognito: boolean } {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('engine')
  return {
    engine: isSearchEngineId(requested) ? requested : DEFAULT_SEARCH_ENGINE,
    incognito: params.get('incognito') === '1'
  }
}

/**
 * Internal start page. It deliberately avoids the privileged preload API:
 * everything it renders arrives in the URL query string, so the page works in
 * the same sandbox as any normal website.
 */
export function StartPage(): React.JSX.Element {
  const [{ engine, incognito }] = useState(pageOptions)
  const [query, setQuery] = useState('')

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = query.trim()
    if (value === '') return
    window.location.assign(buildSearchUrl(engine, value))
  }

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-auto bg-bg px-6 text-fg">
      <main className="w-full max-w-[560px] pb-16">
        <header className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-black/20">
            <Compass className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight">Voyager</h1>
          {incognito && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted"
              title="You are in incognito mode"
            >
              <VenetianMask className="h-3.5 w-3.5" aria-hidden="true" />
              Incognito
            </span>
          )}
        </header>

        <form onSubmit={submit} role="search">
          <div className="flex h-12 items-center gap-3 rounded-xl border border-border bg-surface px-4 shadow-sm transition-shadow focus-within:border-accent focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              id="start-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search with ${SEARCH_ENGINES[engine].name}`}
              aria-label={`Search with ${SEARCH_ENGINES[engine].name}`}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-muted"
            />
          </div>
        </form>

        <p className="mt-4 text-center text-[12px] text-muted">
          {incognito
            ? 'Pages you visit in this window will not appear in your history.'
            : `Search with ${SEARCH_ENGINES[engine].name} or type a URL in the address bar.`}
        </p>
      </main>
    </div>
  )
}
