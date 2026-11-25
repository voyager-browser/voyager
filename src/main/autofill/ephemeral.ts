import type { AutofillShape } from '../store/autofill'
import type { AutofillStore } from './autofill'

function emptyAutofill(): AutofillShape {
  return {
    addresses: [],
    contacts: [],
    paymentMethods: [],
    formHistory: []
  }
}

/**
 * Autofill data for one incognito window. It has no file backing and no
 * debounced writes, so everything recorded here disappears with the window.
 */
export function createEphemeralAutofillStore(): AutofillStore {
  const data = emptyAutofill()
  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value
    },
    get snapshot() {
      return { ...data }
    }
  }
}
