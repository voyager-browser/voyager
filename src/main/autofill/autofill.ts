import { randomUUID } from 'node:crypto'
import type {
  AutofillAddress,
  AutofillContact,
  AutofillPaymentMethod,
  AutofillState,
  FormHistoryEntry
} from '../../shared/types'
import { getSettings, storesFor } from '../store'
import type { AutofillShape } from '../store/autofill'
import { toAutofillState } from '../store/autofill'
import type { Store } from '../store/Store'

const MAX_FORM_HISTORY = 500
const MAX_FORM_HISTORY_PER_FIELD = 20

/** Autofill data source: a profile's persisted store or an incognito-only store. */
export type AutofillStore = Pick<Store<AutofillShape>, 'get' | 'set' | 'snapshot'>

export function currentAutofillState(
  profileId: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  return toAutofillState(store.snapshot)
}

export function saveAddress(
  profileId: string,
  input: Omit<AutofillAddress, 'id' | 'updatedAt'> & { id?: string },
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  const items = [...(store.get('addresses') ?? [])]
  const now = Date.now()
  const id = input.id && items.some((a) => a.id === input.id) ? input.id : randomUUID()
  const next: AutofillAddress = { ...input, id, updatedAt: now }
  const idx = items.findIndex((a) => a.id === id)
  if (idx >= 0) items[idx] = next
  else items.unshift(next)
  store.set('addresses', items)
  return currentAutofillState(profileId, store)
}

export function deleteAddress(
  profileId: string,
  id: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  store.set(
    'addresses',
    (store.get('addresses') ?? []).filter((a) => a.id !== id)
  )
  return currentAutofillState(profileId, store)
}

export function saveContact(
  profileId: string,
  input: Omit<AutofillContact, 'id' | 'updatedAt'> & { id?: string },
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  const items = [...(store.get('contacts') ?? [])]
  const now = Date.now()
  const id = input.id && items.some((a) => a.id === input.id) ? input.id : randomUUID()
  const next: AutofillContact = { ...input, id, updatedAt: now }
  const idx = items.findIndex((a) => a.id === id)
  if (idx >= 0) items[idx] = next
  else items.unshift(next)
  store.set('contacts', items)
  return currentAutofillState(profileId, store)
}

export function deleteContact(
  profileId: string,
  id: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  store.set(
    'contacts',
    (store.get('contacts') ?? []).filter((a) => a.id !== id)
  )
  return currentAutofillState(profileId, store)
}

export function savePaymentMethod(
  profileId: string,
  input: Omit<AutofillPaymentMethod, 'id' | 'updatedAt'> & { id?: string },
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  const items = [...(store.get('paymentMethods') ?? [])]
  const now = Date.now()
  const id = input.id && items.some((a) => a.id === input.id) ? input.id : randomUUID()
  const next: AutofillPaymentMethod = { ...input, id, updatedAt: now }
  const idx = items.findIndex((a) => a.id === id)
  if (idx >= 0) items[idx] = next
  else items.unshift(next)
  store.set('paymentMethods', items)
  return currentAutofillState(profileId, store)
}

export function deletePaymentMethod(
  profileId: string,
  id: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  store.set(
    'paymentMethods',
    (store.get('paymentMethods') ?? []).filter((a) => a.id !== id)
  )
  return currentAutofillState(profileId, store)
}

function normField(field: string): string {
  return field
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export function recordFormHistory(
  profileId: string,
  field: string,
  value: string,
  store: AutofillStore = storesFor(profileId).autofill
): void {
  if (getSettings(profileId, 'saveFormHistory', true) === false) return
  const f = normField(field)
  const v = value.trim()
  if (!f || !v || v.length > 200) return
  if (/password|passwd|cvv|cvc|csc|secret|token/i.test(f)) return
  const items = [...(store.get('formHistory') ?? [])]
  const now = Date.now()
  const existing = items.find((e) => e.field === f && e.value === v)
  if (existing) {
    existing.count += 1
    existing.updatedAt = now
  } else {
    items.unshift({ id: randomUUID(), field: f, value: v, count: 1, updatedAt: now })
  }
  const byField = new Map<string, FormHistoryEntry[]>()
  for (const e of items.sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)) {
    const list = byField.get(e.field) ?? []
    if (list.length < MAX_FORM_HISTORY_PER_FIELD) {
      list.push(e)
      byField.set(e.field, list)
    }
  }
  const bounded = [...byField.values()]
    .flat()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_FORM_HISTORY)
  store.set('formHistory', bounded)
}

export function getFormHistorySuggestions(
  profileId: string,
  field: string,
  prefix: string,
  store: AutofillStore = storesFor(profileId).autofill
): string[] {
  if (getSettings(profileId, 'saveFormHistory', true) === false) return []
  const f = normField(field)
  if (!f) return []
  const p = prefix.trim().toLowerCase()
  const items = store.get('formHistory') ?? []
  return items
    .filter((e) => e.field === f && (!p || e.value.toLowerCase().startsWith(p)))
    .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
    .slice(0, 6)
    .map((e) => e.value)
}

export function clearFormHistory(
  profileId: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  store.set('formHistory', [])
  return currentAutofillState(profileId, store)
}

export function removeFormHistoryEntry(
  profileId: string,
  id: string,
  store: AutofillStore = storesFor(profileId).autofill
): AutofillState {
  store.set(
    'formHistory',
    (store.get('formHistory') ?? []).filter((e) => e.id !== id)
  )
  return currentAutofillState(profileId, store)
}

export function getAutofillProfileSuggestions(
  profileId: string,
  kind: 'address' | 'contact' | 'payment',
  store: AutofillStore = storesFor(profileId).autofill
): Array<AutofillAddress | AutofillContact | AutofillPaymentMethod> {
  if (kind === 'address') {
    if (getSettings(profileId, 'autofillProfiles', true) === false) return []
    return store.get('addresses') ?? []
  }
  if (kind === 'contact') {
    if (getSettings(profileId, 'autofillProfiles', true) === false) return []
    return store.get('contacts') ?? []
  }
  if (getSettings(profileId, 'autofillPayments', true) === false) return []
  return store.get('paymentMethods') ?? []
}
