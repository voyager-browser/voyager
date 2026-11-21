import type { MouseEvent, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface IconButtonProps {
  children: ReactNode
  label: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  className?: string
  'aria-valuenow'?: number
}

export function IconButton({
  children,
  label,
  onClick,
  disabled,
  className,
  'aria-valuenow': ariaValueNow
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-valuenow={ariaValueNow}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg',
        'transition-colors hover:bg-hover active:bg-hover/70',
        'disabled:pointer-events-none disabled:opacity-35',
        className
      )}
    >
      {children}
    </button>
  )
}
