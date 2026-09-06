import { describe, expect, it } from 'vitest'
import { verifyPurchaseTransaction } from '../server/purchase.mjs'

const expected = { recipient: 'NQ12 RECIPIENT', valueLuna: 1000, reference: 'rep:opaque-purchase-reference' }

describe('canonical purchase verification', () => {
  it('accepts only an included transaction with the exact recipient, amount, and opaque reference', () => {
    expect(verifyPurchaseTransaction(expected, {
      recipient: 'NQ12 RECIPIENT', valueLuna: 1000, reference: 'rep:opaque-purchase-reference', blockNumber: 1234,
    })).toEqual({ included: true })
  })

  it.each([
    [{ recipient: 'NQ99 WRONG', valueLuna: 1000, reference: expected.reference, blockNumber: 1234 }, 'RECIPIENT_MISMATCH'],
    [{ recipient: expected.recipient, valueLuna: 999, reference: expected.reference, blockNumber: 1234 }, 'AMOUNT_MISMATCH'],
    [{ recipient: expected.recipient, valueLuna: 1000, reference: 'property:private-address', blockNumber: 1234 }, 'REFERENCE_MISMATCH'],
    [{ recipient: expected.recipient, valueLuna: 1000, reference: expected.reference, blockNumber: null }, 'NOT_INCLUDED'],
  ])('rejects %s', (transaction, reason) => {
    expect(verifyPurchaseTransaction(expected, transaction)).toEqual({ included: false, reason })
  })
})
