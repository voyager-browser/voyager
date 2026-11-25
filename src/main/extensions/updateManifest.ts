/** Pure helpers for Chrome's extension update protocol, safe to import in tests. */

export const EXTENSION_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface ParsedUpdate {
  version: string
  crxUrl: string
  hashSha256?: string
  /** Google's `noupdate` response means the installed version is current. */
  noUpdate?: boolean
}

export function compareExtensionVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10))
  const b = right.split('.').map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const first = Number.isFinite(a[index]) ? a[index] : 0
    const second = Number.isFinite(b[index]) ? b[index] : 0
    if (first !== second) return first > second ? 1 : -1
  }
  return 0
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match ? decodeXml(match[1] ?? match[2] ?? '') : undefined
}

/** App blocks in a gupdate response; bare updatecheck documents are left whole. */
function appBlocks(xml: string): string[] {
  const blocks = [...xml.matchAll(/<app\b[^>]*>([\s\S]*?)<\/app>/gi)].map((match) => match[0])
  return blocks.length > 0 ? blocks : [xml]
}

function parseUpdateBlock(block: string, baseUrl?: string): ParsedUpdate {
  const check = block.match(/<updatecheck\b([^>]*)>/i)
  const checkAttributes = check?.[1] ?? ''
  const status = check ? attribute(checkAttributes, 'status') : undefined
  if (status?.toLowerCase() === 'noupdate') {
    return { version: '', crxUrl: '', noUpdate: true }
  }
  if (status && status.toLowerCase() !== 'ok') {
    throw new Error(`The extension update service returned ${status}.`)
  }

  const manifestTag = block.match(/<manifest\b([^>]*)>/i)
  const version =
    (manifestTag ? attribute(manifestTag[1] ?? '', 'version') : undefined) ??
    attribute(checkAttributes, 'version')
  if (!version) throw new Error('The extension update response has no version.')

  const packageTag = block.match(/<package\b([^>]*)\/?>/i)
  const packageName = packageTag
    ? attribute(packageTag[1] ?? '', 'name')
    : attribute(checkAttributes, 'package')
  const hashSha256 =
    (packageTag ? attribute(packageTag[1] ?? '', 'hash_sha256') : undefined) ??
    attribute(checkAttributes, 'hash_sha256')

  const urlTag =
    block.match(/<url\b([^>]*)>([\s\S]*?)<\/url>/i) ?? block.match(/<url\b([^>]*)\/?>/i)
  const codebase =
    (urlTag ? attribute(urlTag[1] ?? '', 'codebase') : undefined) ??
    attribute(checkAttributes, 'codebase')
  const inlineUrl = urlTag?.[2] ? decodeXml(urlTag[2]).trim() : undefined
  let crxUrl = codebase ?? inlineUrl
  if (!crxUrl) throw new Error('The extension update response has no package URL.')

  if (baseUrl) crxUrl = new URL(crxUrl, baseUrl).toString()
  if (packageName && (crxUrl.endsWith('/') || !/\.crx(?:$|\?)/i.test(crxUrl))) {
    const downloadRoot = crxUrl.endsWith('/') ? crxUrl : `${crxUrl}/`
    crxUrl = new URL(packageName, downloadRoot).toString()
  }
  const parsed = new URL(crxUrl)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS extension update URLs are supported.')
  }
  return { version, crxUrl: parsed.toString(), ...(hashSha256 ? { hashSha256 } : {}) }
}

/**
 * Parse the Chrome update-check XML Voyager needs. Both the nested
 * manifest/url form and the compact self-hosted
 * `<updatecheck version="..." codebase="..." />` form are supported.
 */
export function parseExtensionUpdateManifest(
  xml: string,
  baseUrl?: string,
  appId?: string
): ParsedUpdate {
  const blocks = appBlocks(xml)
  const selected =
    (appId &&
      blocks.find((block) => {
        const tag = block.match(/<app\b([^>]*)>/i)
        return tag && attribute(tag[1] ?? '', 'appid')?.toLowerCase() === appId.toLowerCase()
      })) ||
    blocks[0]
  return parseUpdateBlock(selected ?? xml, baseUrl)
}
