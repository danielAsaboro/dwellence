import { describe, expect, it } from 'vitest'
import { buildAreaAggregate } from '../server/aggregate.mjs'

const day = 86_400_000
const report = (connectivity, environmentalComfort, confidence = 'low') => JSON.stringify({ confidence, connectivity: { categoryScore: connectivity }, environmentalComfort: { categoryScore: environmentalComfort } })

describe('privacy-safe area aggregation', () => {
  it('suppresses after freshness filtering and caps each contributor-device pair to its newest report', () => {
    const now = Date.UTC(2026, 8, 6)
    const rows = [
      { accepted_by: 'a', sensor_id: '1', accepted_at: now - day, report_json: report(90, 80) },
      { accepted_by: 'a', sensor_id: '1', accepted_at: now - 2 * day, report_json: report(10, 10) },
      { accepted_by: 'b', sensor_id: '2', accepted_at: now - 100 * day, report_json: report(90, 90) },
    ]
    const result = buildAreaAggregate('6.50,3.30', rows, now)
    expect(result.state).toBe('insufficient_evidence')
    expect(result.sampleCount).toBe(1)
    expect(result.contributorDevicePairs).toBe(1)
  })

  it('publishes metadata, recency-weighted scores, and a confidence band only above thresholds', () => {
    const now = Date.UTC(2026, 8, 6)
    const rows = Array.from({ length: 5 }, (_, index) => ({ accepted_by: `wallet-${index}`, sensor_id: `sensor-${index}`, accepted_at: now - index * day, report_json: report(60 + index * 5, 50 + index * 5) }))
    const result = buildAreaAggregate('6.50,3.30', rows, now)
    expect(result.state).toBe('published')
    expect(result.score).toEqual(expect.objectContaining({ scorerVersion: 'area-1', confidence: 'medium' }))
    expect(result.score.confidenceBand.lower).toBeLessThanOrEqual(result.score.confidenceBand.upper)
    expect(result.timeSpan).toEqual({ from: now - 4 * day, to: now })
  })
})
