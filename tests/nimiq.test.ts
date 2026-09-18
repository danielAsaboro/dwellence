import { describe, expect, it } from 'vitest'
import { assertTestnetPaymentConfiguration, connectWallet, requestAbuseControlDeviceHandle, restoreWalletSession, sendPurchasePayment } from '../src/lib/nimiq'

describe('Nimiq Pay connection', () => {
  it('uses the injected provider only after a user-triggered connection action', async () => {
    const calls: string[] = []
    const result = await connectWallet(async () => ({
      isConsensusEstablished: async () => { calls.push('consensus'); return true },
      listAccounts: async () => { calls.push('accounts'); return ['NQ12 TEST'] },
      getNetwork: () => 'nimiq',
    }) as never)

    expect(result).toEqual({ address: 'NQ12 TEST', consensusEstablished: true })
    expect(calls).toEqual(['consensus', 'accounts'])
  })

  it('does not represent an unavailable provider as a connected wallet', async () => {
    await expect(connectWallet(async () => { throw new Error('provider absent') })).rejects.toThrow('Nimiq Pay is unavailable')
  })

  it('rehydrates an already-connected provider without requesting wallet access again', async () => {
    let accountCalls = 0
    const result = await restoreWalletSession(async () => ({
      connected: true,
      isConsensusEstablished: async () => true,
      listAccounts: async () => { accountCalls += 1; return ['NQ12 RESTORED'] },
    }) as never)

    expect(result).toEqual({ address: 'NQ12 RESTORED', consensusEstablished: true })
    expect(accountCalls).toBe(1)
  })

  it('does not call listAccounts when the injected provider is disconnected on reload', async () => {
    let accountCalls = 0
    const result = await restoreWalletSession(async () => ({
      connected: false,
      isConsensusEstablished: async () => true,
      listAccounts: async () => { accountCalls += 1; return ['NQ12 MUST-NOT-BE-QUERIED'] },
    }) as never)

    expect(result).toBeNull()
    expect(accountCalls).toBe(0)
  })

  it('does not send a direct NIM payment before wallet consensus is established', async () => {
    await expect(sendPurchasePayment({ recipient: 'NQ12 TEST', value: 1000, data: 'rep:opaque' }, async () => ({
      isConsensusEstablished: async () => false,
      getNetwork: () => 'nimiq',
    }) as never, 'testnet')).rejects.toThrow('consensus is not established')
  })

  it('refuses payment when the app is not explicitly configured for testnet', async () => {
    await expect(assertTestnetPaymentConfiguration('mainnet')).rejects.toThrow('testnet')
  })

  it('refuses payment through a provider that is not the documented Nimiq provider network', async () => {
    await expect(sendPurchasePayment({ recipient: 'NQ12 TEST', value: 1000, data: 'rep:opaque' }, async () => ({
      getNetwork: () => 'ethereum',
      isConsensusEstablished: async () => true,
      getBlockNumber: async () => 1,
    }) as never, 'testnet')).rejects.toThrow('Nimiq provider network')
  })

  it('requests a device handle only with the explicit anti-abuse consent reason', async () => {
    let receivedReason = ''
    const handle = await requestAbuseControlDeviceHandle(async ({ reason }) => { receivedReason = reason; return 'a'.repeat(64) })
    expect(handle).toBe('a'.repeat(64))
    expect(receivedReason).toContain('anti-abuse')
    expect(receivedReason).toContain('not your identity')
  })
})
