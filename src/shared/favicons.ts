/** Compact Voyager mark used as the favicon for internal pages. */
const VOYAGER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#052c31"/>
  <circle cx="32" cy="32" r="24" fill="none" stroke="#d1fae5" stroke-opacity=".35" stroke-width="2"/>
  <path d="M32 48 16 16M32 48 48 16" fill="none" stroke="#6ee7b7" stroke-width="9" stroke-linecap="round"/>
  <path d="M32 48 16 16" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="2" stroke-linecap="round"/>
  <circle cx="32" cy="51" r="3" fill="#34d399"/>
</svg>`

export const VOYAGER_FAVICON = `data:image/svg+xml,${encodeURIComponent(VOYAGER_ICON_SVG)}`
