function canonicalAddress(address) {
  return String(address).replaceAll(' ', '').toUpperCase()
}

export function verifyPurchaseTransaction(expected, transaction) {
  if (!transaction || !Number.isInteger(transaction.blockNumber) || transaction.blockNumber < 0) return { included: false, reason: 'NOT_INCLUDED' }
  if (canonicalAddress(transaction.recipient) !== canonicalAddress(expected.recipient)) return { included: false, reason: 'RECIPIENT_MISMATCH' }
  if (transaction.valueLuna !== expected.valueLuna) return { included: false, reason: 'AMOUNT_MISMATCH' }
  if (transaction.reference !== expected.reference) return { included: false, reason: 'REFERENCE_MISMATCH' }
  return { included: true }
}
