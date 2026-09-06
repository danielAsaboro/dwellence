const DAY = 86_400_000
const THRESHOLDS = { contributorDevicePairs: 5, distinctDays: 3 }

function weightedMean(items, pick, now) {
  const weighted = items.map((item) => ({ value: pick(item.report), weight: Math.exp(-(now - item.accepted_at) / (30 * DAY)) }))
  return Math.round(weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weighted.reduce((sum, item) => sum + item.weight, 0))
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * ratio)]
}

export function buildAreaAggregate(cell, rows, now = Date.now()) {
  const newestByPair = new Map()
  for (const row of rows) {
    if (now - row.accepted_at > 90 * DAY) continue
    const report = JSON.parse(row.report_json)
    if (!['low', 'medium', 'high'].includes(report.confidence)) continue
    const key = `${row.accepted_by}:${row.sensor_id}`
    if (!newestByPair.has(key)) newestByPair.set(key, { ...row, report })
  }
  const qualified = [...newestByPair.values()]
  const days = new Set(qualified.map((row) => new Date(row.accepted_at).toISOString().slice(0, 10)))
  const base = { cell, sampleCount: qualified.length, contributorDevicePairs: qualified.length, distinctDays: days.size, thresholds: THRESHOLDS }
  if (qualified.length < THRESHOLDS.contributorDevicePairs || days.size < THRESHOLDS.distinctDays) return { ...base, state: 'insufficient_evidence' }
  const connectivity = weightedMean(qualified, (report) => report.connectivity.categoryScore, now)
  const environmentalComfort = weightedMean(qualified, (report) => report.environmentalComfort.categoryScore, now)
  const combined = qualified.map(({ report }) => Math.round((report.connectivity.categoryScore + report.environmentalComfort.categoryScore) / 2))
  return { ...base, state: 'published', timeSpan: { from: Math.min(...qualified.map((row) => row.accepted_at)), to: Math.max(...qualified.map((row) => row.accepted_at)) }, score: { connectivity, environmentalComfort, confidence: 'medium', confidenceBand: { lower: percentile(combined, 0.25), upper: percentile(combined, 0.75) }, scorerVersion: 'area-1', method: '90-day freshness, 30-day exponential recency weighting, newest report per contributor-device pair' } }
}
