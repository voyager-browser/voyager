import type {
  AutofillAddress,
  AutofillContact,
  AutofillPaymentMethod,
  AutofillState,
  FormHistoryEntry
} from '../../shared/types'

export interface AutofillShape {
  addresses: AutofillAddress[]
  contacts: AutofillContact[]
  paymentMethods: AutofillPaymentMethod[]
  formHistory: FormHistoryEntry[]
}

export const EMPTY_AUTOFILL: AutofillShape = {
  addresses: [],
  contacts: [],
  paymentMethods: [],
  formHistory: []
}

export function toAutofillState(shape: AutofillShape): AutofillState {
  return {
    addresses: shape.addresses ?? [],
    contacts: shape.contacts ?? [],
    paymentMethods: shape.paymentMethods ?? [],
    formHistory: shape.formHistory ?? []
  }
}
