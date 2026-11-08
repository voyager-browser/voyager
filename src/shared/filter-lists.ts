/**
 * Optional hosts-format filter lists that can be enabled alongside the
 * built-in domain list. Every URL must serve a classic hosts file
 * (`0.0.0.0 domain` / `127.0.0.1 domain` lines) so the existing parser can
 * consume it without an adblock rule engine.
 */
export type FilterListId = 'adaway' | 'stevenblack' | 'peter-lowe' | '1hosts-lite'

export interface FilterListInfo {
  id: FilterListId
  name: string
  url: string
  description: string
}

export const FILTER_LISTS: readonly FilterListInfo[] = [
  {
    id: 'adaway',
    name: 'AdAway',
    url: 'https://adaway.org/hosts.txt',
    description: 'A balanced mobile-friendly ad blocker list.'
  },
  {
    id: 'stevenblack',
    name: 'StevenBlack Unified',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    description: 'Widely used combined adware, malware, and tracker hosts list.'
  },
  {
    id: 'peter-lowe',
    name: "Peter Lowe's Ad and tracking server list",
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
    description: 'Long-running, conservative list of ad and tracking servers.'
  },
  {
    id: '1hosts-lite',
    name: '1Hosts Lite',
    url: 'https://raw.githubusercontent.com/badmojr/1Hosts/master/Lite/hosts.txt',
    description: 'Lightweight list intended to avoid breaking sites.'
  }
] as const

/** Lists enabled for existing installations; preserves the previous behavior. */
export const DEFAULT_FILTER_LISTS: readonly FilterListId[] = ['adaway']

export function isFilterListId(value: unknown): value is FilterListId {
  return typeof value === 'string' && FILTER_LISTS.some((list) => list.id === value)
}

export function filterListFor(id: FilterListId): FilterListInfo | undefined {
  return FILTER_LISTS.find((list) => list.id === id)
}
