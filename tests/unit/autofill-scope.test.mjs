import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEphemeralAutofillStore } from '../../src/main/autofill/ephemeral.ts'
import { createAutofillScopeResolver } from '../../src/main/autofill/scope.ts'

test('normal windows use the profile store without an ephemeral scope', () => {
  const resolve = createAutofillScopeResolver(createEphemeralAutofillStore)
  const normalWindow = { profile: 'work', isIncognito: false }

  assert.deepEqual(resolve(normalWindow, 'default'), {
    profileId: 'work',
    ephemeral: false
  })
  assert.deepEqual(resolve(null, 'default'), { profileId: 'default', ephemeral: false })
})

test('each incognito window gets a stable store isolated from its owner', () => {
  const resolve = createAutofillScopeResolver(createEphemeralAutofillStore)
  const incognitoA = { profile: 'work', isIncognito: true }
  const incognitoB = { profile: 'work', isIncognito: true }

  const first = resolve(incognitoA, 'default')
  const again = resolve(incognitoA, 'default')
  const second = resolve(incognitoB, 'default')

  assert.equal(first.profileId, 'work')
  assert.equal(first.ephemeral, true)
  assert.equal(first.store, again.store)
  assert.notEqual(first.store, second.store)

  first.store.set('formHistory', [
    { id: 'only-here', field: 'email', value: 'a', count: 1, updatedAt: 1 }
  ])
  assert.equal(second.store.get('formHistory').length, 0)
  assert.equal(resolve({ profile: 'work', isIncognito: false }, 'default').store, undefined)
})

test('ephemeral autofill stores are independent of each other', () => {
  const first = createEphemeralAutofillStore()
  const second = createEphemeralAutofillStore()

  first.set('contacts', [{ id: 'c', name: 'Alice', updatedAt: 1 }])
  assert.equal(second.get('contacts').length, 0)

  const snapshot = first.snapshot
  assert.notEqual(snapshot, first.snapshot)
  assert.deepEqual(snapshot.contacts, first.get('contacts'))
})
