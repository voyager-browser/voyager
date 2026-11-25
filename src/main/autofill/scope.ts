import type { AutofillStore } from './autofill'

/** The minimal window information autofill IPC needs to pick its data source. */
export interface AutofillSenderWindow {
  /** Owning profile, whose settings still apply in incognito. */
  profile: string
  isIncognito: boolean
}

export interface AutofillScope {
  profileId: string
  /** Only set for incognito windows; never backed by a profile JSON store. */
  store?: AutofillStore
  ephemeral: boolean
}

/**
 * Resolve autofill IPC to one in-memory store per incognito window. Normal
 * windows keep using their profile's persisted autofill data. A WeakMap keys
 * the ephemeral stores by window, so closed windows release their data.
 */
export function createAutofillScopeResolver(
  createStore: () => AutofillStore
): (window: AutofillSenderWindow | null, fallbackProfileId: string) => AutofillScope {
  const ephemeralStores = new WeakMap<AutofillSenderWindow, AutofillStore>()
  return (window, fallbackProfileId) => {
    if (window?.isIncognito) {
      let store = ephemeralStores.get(window)
      if (!store) {
        store = createStore()
        ephemeralStores.set(window, store)
      }
      return { profileId: window.profile, store, ephemeral: true }
    }
    return {
      profileId: window?.profile ?? fallbackProfileId,
      ephemeral: false
    }
  }
}
