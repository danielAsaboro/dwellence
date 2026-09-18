import { init, requestDeviceIdentifier, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { withTimeout } from './transport'

type InitProvider = () => Promise<NimiqProvider>
type DeviceIdentifierRequester = (options: { reason: string }) => Promise<string>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function connectWallet(getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  let provider: NimiqProvider
  try {
    provider = await getProvider()
  } catch (error) {
    throw new Error(`Nimiq Pay is unavailable: ${errorMessage(error)}`)
  }
  const [consensusEstablished, accounts] = await Promise.all([
    withTimeout(provider.isConsensusEstablished(), 10_000, 'Nimiq consensus check'),
    withTimeout(provider.listAccounts(), 10_000, 'Nimiq account request'),
  ])
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('No Nimiq account was approved')
  return { address: accounts[0], consensusEstablished }
}

/**
 * Rehydrate only a provider that the host already considers connected.
 *
 * Calling listAccounts() on a fresh provider can trigger a native wallet
 * approval. Reload recovery must not silently initiate that approval, so a
 * disconnected provider is left for the explicit reconnect button instead.
 */
export async function restoreWalletSession(getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  let provider: NimiqProvider
  try {
    provider = await withTimeout(getProvider(), 10_000, 'Nimiq Pay provider')
  } catch {
    return null
  }
  if (!provider.connected) return null

  try {
    const [consensusEstablished, accounts] = await Promise.all([
      withTimeout(provider.isConsensusEstablished(), 10_000, 'Nimiq consensus check'),
      withTimeout(provider.listAccounts(), 10_000, 'Nimiq account request'),
    ])
    if (!Array.isArray(accounts) || accounts.length === 0) return null
    return { address: accounts[0], consensusEstablished }
  } catch {
    return null
  }
}

export async function assertTestnetPaymentConfiguration(configuredNetwork = import.meta.env.VITE_NIMIQ_NETWORK): Promise<void> {
  if (configuredNetwork !== 'testnet') throw new Error('Nimiq testnet payment is disabled until the app is explicitly configured for testnet')
}

export async function requestAbuseControlDeviceHandle(requester: DeviceIdentifierRequester = requestDeviceIdentifier) {
  return requester({ reason: 'Use an origin-scoped device handle for anti-abuse controls. This identifies this device, not your identity.' })
}

export async function signMessage(message: string, getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  const provider = await withTimeout(getProvider(), 10_000, 'Nimiq Pay provider')
  const result = await withTimeout(provider.sign(message), 10_000, 'Nimiq signature request')
  if ('error' in result) throw new Error(result.error.message)
  return result
}

export async function sendNimWithReference(input: { recipient: string; value: number; data: string; validityStartHeight: number }, getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  const provider = await withTimeout(getProvider(), 10_000, 'Nimiq Pay provider')
  const result = await withTimeout(provider.sendBasicTransactionWithData(input), 10_000, 'Nimiq payment request')
  if (typeof result !== 'string') throw new Error(result.error.message)
  return result
}

export async function sendPurchasePayment(input: { recipient: string; value: number; data: string }, getProvider: InitProvider = () => init({ timeout: 10_000 }), configuredNetwork = import.meta.env.VITE_NIMIQ_NETWORK) {
  await assertTestnetPaymentConfiguration(configuredNetwork)
  const provider = await withTimeout(getProvider(), 10_000, 'Nimiq Pay provider')
  if (provider.getNetwork() !== 'nimiq') throw new Error('Nimiq provider network is unavailable')
  if (!await withTimeout(provider.isConsensusEstablished(), 10_000, 'Nimiq consensus check')) throw new Error('Nimiq Pay consensus is not established')
  const validityStartHeight = await withTimeout(provider.getBlockNumber(), 10_000, 'Nimiq block height request')
  const result = await withTimeout(provider.sendBasicTransactionWithData({ ...input, validityStartHeight }), 10_000, 'Nimiq payment request')
  if (typeof result !== 'string') throw new Error(result.error.message)
  return result
}
