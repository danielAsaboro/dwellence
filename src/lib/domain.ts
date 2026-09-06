const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

export interface ConnectivityInput {
  downloadMbps: number
  uploadMbps: number
  latencyMs: number
  jitterMs: number
  packetLossPercent: number | null
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)))
}

function higherIsBetter(value: number, excellent: number): number {
  return clampScore((value / excellent) * 100)
}

function lowerIsBetter(value: number, excellent: number, unacceptable: number): number {
  if (value <= excellent) return 100
  if (value >= unacceptable) return 0
  return clampScore(((unacceptable - value) / (unacceptable - excellent)) * 100)
}

export function encodePurchaseReference(purchaseId: string): string {
  const bytes = new TextEncoder().encode(purchaseId)
  let bits = 0
  let bitCount = 0
  let encoded = ''

  for (const byte of bytes) {
    bits = (bits << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      encoded += BASE32[(bits >>> (bitCount - 5)) & 31]
      bitCount -= 5
    }
  }
  if (bitCount > 0) encoded += BASE32[(bits << (5 - bitCount)) & 31]

  return `rep:${encoded.slice(0, 56)}`
}

export function calculateConnectivityScore(input: ConnectivityInput): number {
  const components = [
    { weight: 25, score: higherIsBetter(input.downloadMbps, 100) },
    { weight: 15, score: higherIsBetter(input.uploadMbps, 50) },
    { weight: 25, score: lowerIsBetter(input.latencyMs, 10, 300) },
    { weight: 20, score: lowerIsBetter(input.jitterMs, 2, 100) },
  ]

  if (input.packetLossPercent !== null) {
    components.push({ weight: 15, score: lowerIsBetter(input.packetLossPercent, 0, 10) })
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0)
  return clampScore(components.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight)
}

export function calculateComfortScore(input: { temperatureC: number; humidityPercent: number }): number {
  const temperature = lowerIsBetter(Math.abs(input.temperatureC - 24), 0, 12)
  const humidity = lowerIsBetter(Math.abs(input.humidityPercent - 50), 0, 40)
  return clampScore((temperature + humidity) / 2)
}

export function aggregateStatus(input: { contributorDevicePairs: number; distinctDays: number }): 'suppressed' | 'eligible' {
  return input.contributorDevicePairs >= 5 && input.distinctDays >= 3 ? 'eligible' : 'suppressed'
}
