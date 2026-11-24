import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, RotateCcw, Upload } from 'lucide-react'
import { readableTextColor, THEME_COLOR_KEYS } from '../../../shared/theme'
import type {
  BrowserThemeColors,
  ThemeColorKey,
  ThemeFileInput,
  ThemeStartPageInput
} from '../../../shared/types'
import { useTheme } from './providers/theme-context'

const COLOR_LABELS: Record<ThemeColorKey, string> = {
  background: 'Chrome background',
  foreground: 'Chrome text',
  accent: 'Accent',
  border: 'Borders',
  muted: 'Muted text',
  surface: 'Surface'
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

function readThemeFile(file: File): Promise<ThemeFileInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const separator = result.indexOf(',')
      if (separator === -1) {
        reject(new Error('Could not read that file.'))
        return
      }
      resolve({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: result.slice(separator + 1)
      })
    }
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not apply that theme.'
}

/** Appearance controls for the chrome palette, Chrome imports and New Tab art. */
export function ThemeSettings(): React.JSX.Element {
  const { chrome, startPage, setColors, setStartPage, importFiles, importStore, resetTheme } =
    useTheme()
  const [draft, setDraft] = useState<BrowserThemeColors>(chrome.colors)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [storeUrl, setStoreUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setDraft(chrome.colors)
  }, [chrome.colors])

  const updateColor = (key: ThemeColorKey, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setColors({ [key]: value })
    setError(null)
  }

  const applyStartPage = async (input: ThemeStartPageInput): Promise<void> => {
    setError(null)
    try {
      await setStartPage(input)
      setNotice(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const importTheme = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const inputs = await Promise.all(Array.from(files).map(readThemeFile))
      const result = await importFiles(inputs)
      setNotice(`Applied ${result.chrome.name}.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const importStoreTheme = async (): Promise<void> => {
    if (!storeUrl.trim()) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await importStore(storeUrl)
      setNotice(`Applied ${result.chrome.name}.`)
      setStoreUrl('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const chooseStartImage = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError(null)
    try {
      const image = await readThemeFile(file)
      await setStartPage({ kind: 'image', image })
      setNotice('New Tab background updated.')
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const reset = (): void => {
    resetTheme()
    setError(null)
    setNotice('Restored the default Voyager theme.')
  }

  const previewBackground = chrome.backgroundImage
    ? `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url("${chrome.backgroundImage}")`
    : draft.background

  return (
    <div data-settings-section="theme" className="mt-5 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-fg">Browser theme</h3>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Saved for this profile. {chrome.name}
            {chrome.version ? ` ${chrome.version}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-fg hover:bg-hover"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset to defaults
        </button>
      </div>

      <div
        aria-label="Theme preview"
        className="mt-3 rounded-lg border p-3"
        style={{
          background: previewBackground,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: draft.foreground,
          borderColor: draft.border
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-1 text-[12px]"
            style={{ background: draft.surface, color: draft.foreground }}
          >
            Toolbar Aa
          </span>
          <span
            className="rounded px-2 py-1 text-[12px] font-medium"
            style={{ background: draft.accent, color: readableTextColor(draft.accent) }}
          >
            Accent
          </span>
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: draft.muted }}>
          Live preview — changes apply to every Voyager window.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {THEME_COLOR_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-[12px] text-fg">
            <input
              type="color"
              aria-label={COLOR_LABELS[key]}
              value={draft[key]}
              onChange={(event) => updateColor(key, event.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            <span>{COLOR_LABELS[key]}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[12px] font-medium text-fg">Import a Chrome theme</p>
        <p className="mt-0.5 text-[11.5px] text-muted">
          Choose a .crx/.zip theme pack, or a manifest.json plus its theme images.
        </p>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] text-accent-fg">
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? 'Importing…' : 'Choose theme files'}
          <input
            type="file"
            multiple
            accept=".crx,.zip,.json,image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="sr-only"
            onChange={(event) => {
              const files = event.target.files
              event.target.value = ''
              void importTheme(files)
            }}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            aria-label="Chrome Web Store theme URL"
            value={storeUrl}
            onChange={(event) => setStoreUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void importStoreTheme()
            }}
            placeholder="https://chromewebstore.google.com/detail/…"
            className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[12px] text-fg outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="button"
            disabled={busy || !storeUrl.trim()}
            onClick={() => void importStoreTheme()}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] text-accent-fg disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Install theme'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Paste a Chrome Web Store theme URL to download and apply it.
        </p>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[12px] font-medium text-fg">New Tab background</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-fg">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="start-background"
              checked={startPage.kind === 'default'}
              onChange={() => void applyStartPage({ kind: 'default' })}
            />
            Default
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="start-background"
              checked={startPage.kind === 'color'}
              onChange={() => void applyStartPage({ kind: 'color', color: draft.background })}
            />
            Color
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="start-background"
              checked={startPage.kind === 'image'}
              onChange={() => {
                if (!startPage.image) imageInputRef.current?.click()
              }}
            />
            Image
          </label>
        </div>

        {startPage.kind === 'color' && (
          <label className="mt-2 flex items-center gap-2 text-[12px] text-fg">
            <input
              type="color"
              aria-label="New Tab color"
              value={startPage.color ?? draft.background}
              onChange={(event) =>
                void applyStartPage({ kind: 'color', color: event.target.value })
              }
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            Background color
          </label>
        )}

        {startPage.kind === 'image' && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {startPage.image && (
              <img
                src={startPage.image}
                alt="New Tab background preview"
                className="h-12 w-20 rounded border border-border object-cover"
              />
            )}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-fg hover:bg-hover">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Choose image
              <input
                ref={imageInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void chooseStartImage(file)
                }}
              />
            </label>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[11.5px] text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-[11.5px] text-muted">
          {notice}
        </p>
      )}
      {!error && !notice && (
        <p className="mt-3 text-[11.5px] text-muted">
          Incognito windows keep their private palette regardless of this theme.
        </p>
      )}
    </div>
  )
}
