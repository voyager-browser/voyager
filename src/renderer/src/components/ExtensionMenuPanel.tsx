import { useEffect, useMemo, useState } from 'react'
import { Puzzle, X } from 'lucide-react'
import type { ExtensionHostAccess, ExtensionInfo } from '../../../shared/types'

const SECTIONS: Array<{
  access: ExtensionHostAccess
  title: string
  description: string
}> = [
  {
    access: 'full',
    title: 'Full access',
    description: 'These extensions can see and change information on this site.'
  },
  {
    access: 'request',
    title: 'Access requested',
    description: 'To give an extension access to this site, click it.'
  },
  {
    access: 'none',
    title: 'No access needed',
    description: "These extensions don't need to see and change information on this site."
  }
]

function PinToggle({
  extension,
  onChanged
}: {
  extension: ExtensionInfo
  onChanged: (state: ExtensionInfo[]) => void
}): React.JSX.Element | null {
  if (!extension.id) return null
  const label = extension.pinned ? 'Unpin extension' : 'Pin extension'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`relative grid h-7 w-7 place-items-center rounded-md hover:bg-hover ${
        extension.pinned ? 'text-accent' : 'text-muted'
      }`}
      onClick={(event) => {
        event.stopPropagation()
        void window.voyager.extensions
          .setPinned(extension.id as string, !extension.pinned)
          .then(onChanged)
          .catch(() => undefined)
      }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M16 3l5 5-2.1.8-3.1 3.1.4 3.4-1.7 1.7-3.2-3.2-4.4 4.4-.7-.7 4.4-4.4-3.2-3.2L8.7 10l3.4.4 3.1-3.1L16 3z" />
      </svg>
      {extension.pinned && (
        <span className="pointer-events-none absolute left-1 top-1/2 h-px w-5 -rotate-45 bg-accent" />
      )}
    </button>
  )
}

function ExtensionRow({
  extension,
  origin,
  onChanged
}: {
  extension: ExtensionInfo
  origin: { x: number; y: number }
  onChanged: (state: ExtensionInfo[]) => void
}): React.JSX.Element {
  const open = (): void => {
    if (!extension.id || !extension.action?.popup) return
    const rect = document
      .querySelector(`[data-extension-row="${extension.id}"]`)
      ?.getBoundingClientRect()
    // openPopup expects window coordinates; the menu's rect is panel-relative.
    // The main process closes this menu panel before showing the popup, so do
    // not call closePanel() here — it would destroy this renderer first.
    const x = (rect?.right ?? 0) + origin.x
    const y = (rect?.bottom ?? 0) + origin.y
    void window.voyager.extensions.openPopup(
      extension.id as string,
      extension.action?.popup as string,
      x,
      y
    )
  }
  return (
    <div
      data-extension-row={extension.id ?? undefined}
      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={open}
        disabled={!extension.action?.popup}
      >
        {extension.action?.iconUrl ? (
          <img
            src={extension.action.iconUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded object-contain"
          />
        ) : (
          <Puzzle className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        )}
        <span className="truncate text-sm text-fg">{extension.name}</span>
      </button>
      <PinToggle extension={extension} onChanged={onChanged} />
      <button
        type="button"
        aria-label={`More options for ${extension.name}`}
        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          void window.voyager.extensions.showContextMenu(
            extension.id ?? '',
            rect.right,
            rect.bottom
          )
        }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
    </div>
  )
}

export function ExtensionMenuPanel(): React.JSX.Element {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const disposers = [
      window.voyager.extensions.onMenuOpen((payload) => {
        setOrigin(payload.origin)
        void window.voyager.extensions
          .getState()
          .then(setExtensions)
          .catch(() => undefined)
        setReady(true)
      }),
      window.voyager.extensions.onStateChanged(setExtensions)
    ]
    void window.voyager.extensions
      .getState()
      .then(setExtensions)
      .catch(() => undefined)
    setReady(true)
    return () => disposers.forEach((dispose) => dispose())
  }, [])

  const grouped = useMemo(() => {
    const result: Record<ExtensionHostAccess, ExtensionInfo[]> = {
      full: [],
      request: [],
      none: []
    }
    for (const extension of extensions) result[extension.hostAccess].push(extension)
    return result
  }, [extensions])

  return (
    <div className="extension-menu flex max-h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold tracking-wide text-fg">Extensions</h1>
        <button
          type="button"
          aria-label="Close extensions menu"
          className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-hover"
          onClick={() => void window.voyager.extensions.closePanel()}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="overflow-y-auto px-2 py-2">
        {ready && extensions.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">No extensions installed.</p>
        )}
        {SECTIONS.filter((section) => grouped[section.access].length > 0).map((section) => (
          <section key={section.access} className="mb-3 last:mb-0">
            <h2 className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {section.title}
            </h2>
            <p className="px-2 pb-1 pt-0.5 text-xs text-muted">{section.description}</p>
            {grouped[section.access].map((extension) => (
              <ExtensionRow
                key={extension.path}
                extension={extension}
                origin={origin}
                onChanged={setExtensions}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
