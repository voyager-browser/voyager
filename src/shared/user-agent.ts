export interface UserAgentPreset {
  id: string
  label: string
  userAgent: string
}

export const DEFAULT_USER_AGENT_ID = 'default'

/** Common UA presets. Keep strings realistic; headers/userAgent are spoofed from these. */
export const USER_AGENT_PRESETS: readonly UserAgentPreset[] = [
  { id: 'default', label: 'Default', userAgent: '' },
  {
    id: 'chrome-mac',
    label: 'Chrome (macOS)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  {
    id: 'chrome-windows',
    label: 'Chrome (Windows)',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  {
    id: 'firefox-mac',
    label: 'Firefox (macOS)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'
  },
  {
    id: 'safari-mac',
    label: 'Safari (macOS)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
  }
]

export function userAgentForId(id: string): string {
  return USER_AGENT_PRESETS.find((p) => p.id === id)?.userAgent ?? ''
}

export function userAgentPresetId(ua: string): string {
  if (!ua) return 'default'
  return USER_AGENT_PRESETS.find((p) => p.userAgent === ua)?.id ?? 'custom'
}
