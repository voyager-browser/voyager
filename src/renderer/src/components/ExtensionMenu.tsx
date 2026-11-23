import { Puzzle } from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'
import type { ExtensionInfo } from '../../../shared/types'
import { menuAnchorFromElement, type MenuAnchor } from '../lib/menuAnchor'
import { useOverlaySignal } from '../lib/overlay'
import { IconButton } from './ui/IconButton'

interface ExtensionMenuProps {
  extensions: ExtensionInfo[]
}

/** Toolbar menu for extension actions that declare a popup document. */
export function ExtensionMenu({ extensions }: ExtensionMenuProps): React.JSX.Element | null {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const hasActions = extensions.some(
    (extension) => extension.loaded && extension.id && extension.action?.popup
  )
  useOverlaySignal(anchor !== null && hasActions)

  // A native popup takes focus away from the chrome renderer, so the DOM menu
  // would never receive its mouseup/click. Close it as soon as that happens;
  // otherwise the full-window overlay stays open and hides the browser chrome.
  useEffect(() => {
    if (!anchor) return
    const close = (): void => setAnchor(null)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [anchor])

  useEffect(() => {
    if (!hasActions) setAnchor(null)
  }, [hasActions])

  const actions = extensions.filter(
    (extension) => extension.loaded && extension.id && extension.action?.popup
  )
  if (actions.length === 0) return null

  const openPopup = (extension: ExtensionInfo, element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    setAnchor(null)
    // Closing the menu releases the overlay through useOverlaySignal's cleanup,
    // but the native popup can steal focus before that cleanup runs and leave
    // the chrome view expanded over the whole window. Force the chrome back to
    // its normal bounds immediately so the tab bar and drag region stay usable.
    void window.voyager.ui.setOverlayOpen(false)
    void window.voyager.extensions
      .openPopup(extension.id as string, extension.action?.popup as string, rect.right, rect.bottom)
      .catch(() => undefined)
  }

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    setAnchor((current) => (current ? null : menuAnchorFromElement(event.currentTarget)))
  }

  return (
    <>
      <IconButton label="Extensions" onClick={toggle}>
        <Puzzle className="h-4 w-4" />
      </IconButton>
      {anchor && (
        <div className="fixed inset-0 z-40" onMouseDown={() => setAnchor(null)}>
          <div
            role="menu"
            aria-label="Extensions"
            className="no-drag absolute w-[240px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl shadow-black/20"
            style={{ top: anchor.top, right: anchor.right }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Extensions
            </div>
            {actions.map((extension) => (
              <button
                key={extension.path}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-fg transition-colors hover:bg-hover"
                onClick={(event) => openPopup(extension, event.currentTarget)}
              >
                <Puzzle className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate">{extension.action?.title || extension.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
