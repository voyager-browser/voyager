import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

/**
 * Native-style window buttons for frameless non-macOS windows. macOS keeps its
 * red/yellow/green controls on the left and is handled by the drag padding in
 * the top chrome row instead.
 */
export function WindowControls(): React.JSX.Element | null {
  const platform = window.voyager.platform
  const [maximized, setMaximized] = useState(false)

  const refresh = (): void => {
    void window.voyager.windows.getState().then((state) => setMaximized(state.maximized))
  }

  useEffect(() => {
    refresh()
    window.addEventListener('resize', refresh)
    return () => window.removeEventListener('resize', refresh)
  }, [])

  if (platform === 'darwin') return null

  const toggleMaximize = (): void => {
    void window.voyager.windows.toggleMaximize().then(refresh)
  }

  return (
    <div className="no-drag flex shrink-0 items-center self-stretch" aria-label="Window controls">
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void window.voyager.windows.minimize()}
        className="flex h-full w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={toggleMaximize}
        className="flex h-full w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        type="button"
        aria-label="Close window"
        title="Close"
        onClick={() => void window.voyager.windows.close()}
        className="flex h-full w-11 items-center justify-center text-muted transition-colors hover:bg-danger hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
