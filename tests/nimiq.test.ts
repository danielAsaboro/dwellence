import { describe, expect, it } from 'vitest'
import { connectWallet, requestAbuseControlDeviceHandle, sendPurchasePayment } from '../src/lib/nimiq'

describe('Nimiq Pay connection', () => {
  it('uses the injected provider only after a user-triggered connection action', async () => {
    const calls: string[] = []
    const result = await connectWallet(async () => ({
      isConsensusEstablished: async () => { calls.push('consensus'); return true },
      listAccounts: async () => { calls.push('accounts'); return ['NQ12 TEST'] },
    }) as never)

    expect(result).toEqual({ address: 'NQ12 TEST', consensusEstablished: true })
    expect(calls).toEqual(['consensus', 'accounts'])
  })

  it('does not represent an unavailable provider as a connected wallet', async () => {
    await expect(connectWallet(async () => { throw new Error('provider absent') })).rejects.toThrow('Nimiq Pay is unavailable')
  })

  it('does not send a direct NIM payment before wallet consensus is established', async () => {
    await expect(sendPurchasePayment({ recipient: 'NQ12 TEST', value: 1000, data: 'rep:opaque' }, async () => ({
      isConsensusEstablished: async () => false,
    }) as never)).rejects.toThrow('consensus is not established')
  })

  it('requests a device handle only with the explicit anti-abuse consent reason', async () => {
    let receivedReason = ''
    const handle = await requestAbuseControlDeviceHandle(async ({ reason }) => { receivedReason = reason; return 'a'.repeat(64) })
    expect(handle).toBe('a'.repeat(64))
    expect(receivedReason).toContain('anti-abuse')
    expect(receivedReason).toContain('not your identity')
  })
})
