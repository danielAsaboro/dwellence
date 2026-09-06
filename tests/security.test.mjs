import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { consumeNonce, issueNonce, verifyEd25519Signature } from '../server/security.mjs'
import { createStore } from '../server/store.mjs'

function makeStore() {
  return createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-')), 'state.sqlite'))
}

describe('server nonces', () => {
  it('can be consumed exactly once by its intended purpose and binding', () => {
    const store = makeStore()
    const nonce = issueNonce(store, 'wallet-auth', 'seeker:EQ00')

    expect(consumeNonce(store, nonce, 'wallet-auth', 'seeker:EQ00')).toBe(true)
    expect(consumeNonce(store, nonce, 'wallet-auth', 'seeker:EQ00')).toBe(false)
  })

  it('rejects a nonce when its binding differs', () => {
    const store = makeStore()
    const nonce = issueNonce(store, 'measurement', 'request:abc')

    expect(consumeNonce(store, nonce, 'measurement', 'request:def')).toBe(false)
  })

  it('rejects expired nonces', () => {
    const store = makeStore()
    const nonce = issueNonce(store, 'wallet-auth', 'seeker:EQ00', -1)

    expect(consumeNonce(store, nonce, 'wallet-auth', 'seeker:EQ00')).toBe(false)
  })
})

describe('Ed25519 signatures', () => {
  it('verifies a signature against its raw registered device public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const message = Buffer.from('location-evidence sensor challenge')
    const signature = sign(null, message, privateKey)
    const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)

    expect(verifyEd25519Signature(message, signature, rawPublicKey)).toBe(true)
    expect(verifyEd25519Signature(Buffer.from('changed payload'), signature, rawPublicKey)).toBe(false)
  })
})
