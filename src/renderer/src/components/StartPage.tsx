import { useState, type CSSProperties } from 'react'
import { Search, VenetianMask } from 'lucide-react'
import voyagerIcon from '../assets/voyager-icon.svg'
import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINES,
  buildSearchUrl,
  isSearchEngineId
} from '../../../shared/search'
import {
  contrastRatio,
  ensureContrast,
  mixColors,
  normalizeHexColor,
  readableTextColor,
  relativeLuminance,
  sanitizeThemeAssetUrl
} from '../../../shared/theme'

interface StartPageOptions {
  engine: keyof typeof SEARCH_ENGINES
  incognito: boolean
  background: 'default' | 'color' | 'image'
  backgroundColor: string
  backgroundImage?: string
  foreground: string
  accent: string
}

/** The start page is unprivileged: appearance arrives entirely via the URL. */
function pageOptions(): StartPageOptions {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('engine')
  const requestedBackground = params.get('bg')
  const color = normalizeHexColor(params.get('bgc'))
  const base = normalizeHexColor(params.get('base'))
  const image = sanitizeThemeAssetUrl(params.get('bgi'))
  const background =
    requestedBackground === 'color' && color
      ? 'color'
      : requestedBackground === 'image' && image
        ? 'image'
        : 'default'
  const backgroundColor = color ?? base ?? '#f2f2f5'
  const requestedForeground = normalizeHexColor(params.get('fg'))
  const foreground =
    background === 'image'
      ? '#ffffff'
      : requestedForeground && contrastRatio(requestedForeground, backgroundColor) >= 4.5
        ? requestedForeground
        : readableTextColor(backgroundColor)
  const accent = normalizeHexColor(params.get('accent')) ?? '#3478f6'
  return {
    engine: isSearchEngineId(requested) ? requested : DEFAULT_SEARCH_ENGINE,
    incognito: params.get('incognito') === '1',
    background,
    backgroundColor,
    ...(image ? { backgroundImage: image } : {}),
    foreground,
    accent
  }
}

/**
 * Internal start page. It deliberately avoids the privileged preload API:
 * everything it renders arrives in the URL query string, so the page works in
 * the same sandbox as any normal website.
 */
export function StartPage(): React.JSX.Element {
  const [options] = useState(pageOptions)
  const { engine, incognito, background, backgroundColor, backgroundImage, foreground, accent } =
    options
  const [query, setQuery] = useState('')

  const imageBackground = background === 'image'
  const surface = imageBackground
    ? 'rgba(12, 12, 18, 0.55)'
    : relativeLuminance(backgroundColor) > 0.5
      ? '#ffffff'
      : mixColors(backgroundColor, '#000000', 0.22)
  const resolvedAccent = imageBackground ? ensureContrast(accent, '#101018', 3, true) : accent
  // Incognito exposes its palette through .incognito; inline values would win.
  const chromeStyle = incognito
    ? {}
    : ({
        '--voyager-fg': foreground,
        '--voyager-muted': imageBackground
          ? '#e2e2ea'
          : ensureContrast(
              mixColors(foreground, surface, 0.32),
              surface,
              3,
              relativeLuminance(surface) < 0.5
            ),
        '--voyager-border': imageBackground
          ? 'rgba(255, 255, 255, 0.32)'
          : mixColors(surface, foreground, 0.18),
        '--voyager-surface': surface,
        '--voyager-accent': resolvedAccent,
        '--voyager-accent-fg': readableTextColor(resolvedAccent)
      } as CSSProperties)
  const backgroundStyle: CSSProperties = incognito ? {} : { ...chromeStyle, backgroundColor }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = query.trim()
    if (value === '') return
    window.location.assign(buildSearchUrl(engine, value))
  }

  return (
    <div
      data-start-background={background}
      className={`relative flex h-full flex-col items-center justify-center overflow-auto bg-bg px-6 text-fg ${
        incognito ? 'incognito' : ''
      }`}
      style={backgroundStyle}
    >
      {imageBackground && backgroundImage && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${backgroundImage}")` }}
          />
          {/* A consistent scrim keeps the search card legible over any image. */}
          <div aria-hidden="true" className="absolute inset-0 bg-black/45" />
        </>
      )}
      <main className="relative z-10 w-full max-w-[560px] pb-16">
        <header className="mb-8 flex flex-col items-center gap-3">
          <img
            src={voyagerIcon}
            alt="Voyager icon"
            className="h-16 w-16 rounded-2xl shadow-lg shadow-black/20"
            draggable={false}
          />
          <h1 className="text-[28px] font-semibold tracking-tight">Voyager</h1>
          {incognito && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-accent bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg"
              title="You are in incognito mode"
              aria-label="You are in incognito mode"
            >
              <VenetianMask className="h-3.5 w-3.5" aria-hidden="true" />
              Incognito
            </span>
          )}
        </header>

        <form onSubmit={submit} role="search">
          <div
            className={`flex h-12 items-center gap-3 rounded-xl border border-border bg-surface px-4 shadow-lg transition-shadow focus-within:border-accent focus-within:ring-2 focus-within:ring-ring ${
              imageBackground ? 'backdrop-blur-md' : ''
            }`}
          >
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
