export interface PaymentVerification {
  state: string
  reportId?: string
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
