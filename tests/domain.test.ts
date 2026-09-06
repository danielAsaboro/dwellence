import { describe, expect, it } from 'vitest'
import {
  aggregateStatus,
  calculateComfortScore,
  calculateConnectivityScore,
  encodePurchaseReference,
} from '../src/lib/domain'

describe('purchase references', () => {
  it('encodes an opaque, data-limit-friendly reference without property information', () => {
    const reference = encodePurchaseReference('purchase_01J9QY7K7S4VJ8N5W2M6D1A3XZ')

    expect(reference).toMatch(/^rep:[a-z2-7]+$/)
    expect(reference).not.toContain('purchase')
    expect(reference.length).toBeLessThanOrEqual(64)
  })
})

describe('connectivity score', () => {
  it('uses disclosed component weights when packet loss is available', () => {
    expect(calculateConnectivityScore({
      downloadMbps: 100,
      uploadMbps: 50,
      latencyMs: 10,
      jitterMs: 2,
      packetLossPercent: 0,
    })).toBe(100)
  })

  it('redistributes only packet-loss weight when packet loss is unavailable', () => {
    expect(calculateConnectivityScore({
      downloadMbps: 0,
      uploadMbps: 0,
      latencyMs: 1000,
      jitterMs: 1000,
      packetLossPercent: null,
    })).toBe(0)
  })
})

describe('comfort score', () => {
  it('scores an observed comfort-band reading without diagnosing habitability', () => {
    expect(calculateComfortScore({ temperatureC: 24, humidityPercent: 50 })).toBe(100)
  })
})

describe('public aggregation', () => {
  it('suppresses an area score until five independent pairs exist across three days', () => {
    expect(aggregateStatus({ contributorDevicePairs: 5, distinctDays: 2 })).toBe('suppressed')
    expect(aggregateStatus({ contributorDevicePairs: 4, distinctDays: 3 })).toBe('suppressed')
    expect(aggregateStatus({ contributorDevicePairs: 5, distinctDays: 3 })).toBe('eligible')
  })
})
