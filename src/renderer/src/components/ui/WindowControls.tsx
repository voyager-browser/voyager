import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { MAC_TRAFFIC_LIGHT_CLEARANCE } from '../../../../shared/constants'
import { cn } from '../../lib/cn'

/**
 * Native-style window buttons for frameless Windows. macOS keeps its built-in
 * traffic lights, and Linux defers to the desktop environment's decorations
 * (which may show no buttons at all, or a title/icon/button row of their own),
 * so this renders only on win32.
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

  if (platform !== 'win32') return null

  const toggleMaximize = (): void => {
    void window.voyager.windows.toggleMaximize().then(refresh)
  }

  return (
    <div className="no-drag flex h-full shrink-0 items-center" aria-label="Window controls">
      <WindowControlsSeparator className="mr-1.5" />
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

/** Divider between the app chrome and native/custom window controls. */
export function WindowControlsSeparator({
  className
}: {
  className?: string
}): React.JSX.Element | null {
  const platform = window.voyager.platform
  if (platform !== 'darwin' && platform !== 'win32') return null

  return (
    <span aria-hidden="true" className={cn('no-drag h-4 w-px shrink-0 bg-border', className)} />
  )
}

/**
 * macOS puts its window controls at the leading edge. The toolbar is the drag
 * region there, so this divider sits just inside the traffic-light clearance.
 */
export function LeadingWindowControlsSeparator(): React.JSX.Element | null {
  const platform = window.voyager.platform
  if (platform !== 'darwin') return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 flex items-center"
      style={{ left: MAC_TRAFFIC_LIGHT_CLEARANCE - 6 }}
    >
      <WindowControlsSeparator />
    </div>
  )
}
