import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { cn } from '../../lib/cn'

interface FaviconProps {
  src?: string | null
  alt?: string
  className?: string
}

/** Transparent, monochrome favicon slot with a gray globe fallback. */
export function Favicon({ src, alt = '', className }: FaviconProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return <Globe aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-muted', className)} />
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn('h-4 w-4 shrink-0 rounded-sm object-contain', className)}
      onError={() => setFailed(true)}
    />
  )
}
