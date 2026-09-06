import { init, requestDeviceIdentifier, type NimiqProvider } from '@nimiq/mini-app-sdk'

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
  const [consensusEstablished, accounts] = await Promise.all([provider.isConsensusEstablished(), provider.listAccounts()])
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('No Nimiq account was approved')
  return { address: accounts[0], consensusEstablished }
}

export async function requestAbuseControlDeviceHandle(requester: DeviceIdentifierRequester = requestDeviceIdentifier) {
  return requester({ reason: 'Use an origin-scoped device handle for anti-abuse controls. This identifies this device, not your identity.' })
}

export async function signMessage(message: string, getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  const provider = await getProvider()
  const result = await provider.sign(message)
  if ('error' in result) throw new Error(result.error.message)
  return result
}

export async function sendNimWithReference(input: { recipient: string; value: number; data: string; validityStartHeight: number }, getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  const provider = await getProvider()
  const result = await provider.sendBasicTransactionWithData(input)
  if (typeof result !== 'string') throw new Error(result.error.message)
  return result
}

export async function sendPurchasePayment(input: { recipient: string; value: number; data: string }, getProvider: InitProvider = () => init({ timeout: 10_000 })) {
  const provider = await getProvider()
  if (!await provider.isConsensusEstablished()) throw new Error('Nimiq Pay consensus is not established')
  const validityStartHeight = await provider.getBlockNumber()
  const result = await provider.sendBasicTransactionWithData({ ...input, validityStartHeight })
  if (typeof result !== 'string') throw new Error(result.error.message)
  return result
}
