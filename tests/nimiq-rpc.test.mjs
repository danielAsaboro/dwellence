import { describe, expect, it } from 'vitest'
import { lookupIncludedTransaction } from '../server/nimiq-rpc.mjs'

describe('Nimiq RPC transaction lookup', () => {
  it('normalizes canonical RPC fields without trusting a client callback', async () => {
    const transaction = await lookupIncludedTransaction('https://rpc.example', 'hash', async () => new Response(JSON.stringify({ result: {
      recipient: 'NQ12 RECIPIENT', value: 1000, recipientData: Buffer.from('rep:opaque').toString('base64'), blockNumber: 123,
    } }), { headers: { 'content-type': 'application/json' } }))
    expect(transaction).toEqual({ recipient: 'NQ12 RECIPIENT', valueLuna: 1000, reference: 'rep:opaque', blockNumber: 123 })
  })

  it('returns no transaction when the canonical RPC has not included it', async () => {
    await expect(lookupIncludedTransaction('https://rpc.example', 'hash', async () => new Response(JSON.stringify({ result: null }), { headers: { 'content-type': 'application/json' } }))).resolves.toBeNull()
  })
})
