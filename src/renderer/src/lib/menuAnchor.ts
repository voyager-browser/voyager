export interface MenuAnchor {
  /** Viewport y coordinate where the popover should start. */
  top: number
  /** Distance from the right edge of the viewport to the popover's right edge. */
  right: number
}

/** Anchor a popover to the bottom-right corner of its trigger element. */
export function menuAnchorFromElement(element: HTMLElement): MenuAnchor {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.bottom,
    right: Math.max(0, window.innerWidth - rect.right)
  }
}
