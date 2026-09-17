export interface PaymentVerification {
  state: string
  reportId?: string
}

export function recoveryAction(reportState: string, purchaseState: string, hash: string, loadedReportId = '', currentReportId = '') {
  if (loadedReportId !== currentReportId) return 'reload_report'
  if (reportState === 'unlocked') return 'open_report'
  if (/^[0-9a-f]{64}$/i.test(hash)) return 'verify_payment'
  if (hash) return 'recover_hash'
  if (purchaseState !== 'not_started') return 'recover_hash'
  return 'new_payment'
}

type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const RECEIPT_LIFETIME = 90 * 86_400_000

export function persistPaymentReceipt(storage: ReceiptStorage, reportId: string, purchaseId: string, hash: string, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid payment receipt; do not pay again. Recover the original transaction hash from Nimiq Pay.')
  storage.setItem(`dwellence-payment:${reportId}`, JSON.stringify({purchaseId, hash, savedAt: now}))
}

export function recoverPaymentReceipt(storage: ReceiptStorage, reportId: string, purchaseId: string, now = Date.now()): string {
  const key = `dwellence-payment:${reportId}`
  const raw = storage.getItem(key)
  if (!raw) return ''
  try {
    const receipt = JSON.parse(raw)
    if (!Number.isFinite(receipt.savedAt) || receipt.savedAt > now || now - receipt.savedAt >= RECEIPT_LIFETIME || !/^[0-9a-f]{64}$/i.test(receipt.hash)) {
      storage.removeItem(key)
      return ''
    }
    return receipt.purchaseId === purchaseId ? receipt.hash : ''
  } catch {
    storage.removeItem(key)
    return ''
  }
}

export async function pollPaymentInclusion(
  check: () => Promise<PaymentVerification>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  delays: readonly number[] = [2000, 4000, 8000],
): Promise<PaymentVerification> {
  let result = await check()
  for (const delay of delays) {
    if (result.state !== 'pending') return result
    await wait(delay)
    result = await check()
  }
  return result
}
