import { describe, expect, it } from 'vitest'
import { pollPaymentInclusion } from '../src/lib/payment-polling'

describe('payment verification polling', () => {
  it('uses bounded backoff and stops as soon as inclusion is verified', async () => {
    const waits: number[] = []
    let checks = 0
    const result = await pollPaymentInclusion(
      async () => ({ state: ++checks === 3 ? 'included' : 'pending' }),
      async (milliseconds) => { waits.push(milliseconds) },
      [2000, 4000, 8000],
    )
    expect(result.state).toBe('included')
    expect(checks).toBe(3)
    expect(waits).toEqual([2000, 4000])
  })

  it('stops after the configured attempts when inclusion remains pending', async () => {
    let checks = 0
    const result = await pollPaymentInclusion(async () => { checks += 1; return { state: 'pending' } }, async () => {}, [1, 1])
    expect(result.state).toBe('pending')
    expect(checks).toBe(3)
  })
})
