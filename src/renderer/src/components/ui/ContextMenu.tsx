import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { cn } from '../../lib/cn'
import { useOverlaySignal } from '../../lib/overlay'

export interface ContextMenuItem {
  label?: string
  icon?: ReactNode
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  /** Nested items rendered as a submenu. */
  children?: ContextMenuItem[]
  /** When true, render a divider instead of an item. */
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const MENU_PADDING = 8

function MenuList({
  items,
  onClose,
  className,
  style
}: {
  items: ContextMenuItem[]
  onClose: () => void
  className?: string
  style?: CSSProperties
}): React.JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div
      role="menu"
      className={cn(
        'no-drag z-50 min-w-[200px] overflow-visible rounded-xl border border-border bg-surface py-1 shadow-xl shadow-black/15',
        className
      )}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="mx-2 my-1 h-px bg-border" />
        ) : (
          <div
            key={index}
            className="relative"
            onMouseEnter={() => setOpenIndex(item.children ? index : null)}
            onMouseLeave={() => setOpenIndex(null)}
          >
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.children) {
                  setOpenIndex((value) => (value === index ? null : index))
                  return
                }
                onClose()
                item.onSelect?.()
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]',
                'transition-colors hover:bg-hover',
                item.danger ? 'text-danger' : 'text-fg',
                item.disabled && 'pointer-events-none opacity-40'
              )}
            >
              {item.icon && (
                <span className="flex h-4 w-4 items-center justify-center">{item.icon}</span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.checked && <span className="text-accent">✓</span>}
              {item.children && <span className="text-muted">›</span>}
            </button>
            {item.children && openIndex === index && (
              <MenuList
                items={item.children}
                onClose={onClose}
                className="absolute left-full top-0 ml-1"
              />
            )}
          </div>
        )
      )}
    </div>
  )
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useOverlaySignal(true)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const { offsetWidth, offsetHeight } = el
    setPosition({
      left: Math.min(x, innerWidth - offsetWidth - MENU_PADDING),
      top: Math.max(MENU_PADDING, Math.min(y, innerHeight - offsetHeight - MENU_PADDING))
    })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // Defer installing the dismiss listeners until the gesture that opened
    // the menu has finished propagating; otherwise this same mousedown /
    // contextmenu reaches window and immediately closes it.
    const frame = window.setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('blur', close)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('scroll', close, true)
    })
    return () => {
      window.clearTimeout(frame)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  return (
    <div ref={menuRef} className="fixed z-50" style={{ left: position.left, top: position.top }}>
      <MenuList items={items} onClose={onClose} />
    </div>
  )
}
