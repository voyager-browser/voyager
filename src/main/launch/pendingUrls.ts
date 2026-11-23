/** External URLs waiting for a browser window that can open them. */
const pending: string[] = []

/**
 * Queue URLs in arrival order. Empty values and repeats are ignored so a link
 * received from several launch events is only opened once.
 */
export function queuePendingUrls(urls: readonly (string | null | undefined)[]): void {
  for (const url of urls) {
    if (!url || pending.includes(url)) continue
    pending.push(url)
  }
}

/** Remove and return every queued URL, preserving arrival order. */
export function takePendingUrls(): string[] {
  return pending.splice(0)
}
