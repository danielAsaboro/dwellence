import { describe, expect, it } from 'vitest'
import { humanizeApiError } from '../src/lib/errors'

describe('recoverable API errors', () => {
  it.each([
    ['RATE_LIMITED', 'Wait a few minutes'],
    ['REQUEST_EXPIRED', 'Ask the seeker for a new invitation'],
    ['LOCATION_CONFIDENCE_INSUFFICIENT', 'Move where your phone has a clearer location signal'],
    ['REQUIRED_EVIDENCE_MISSING', 'both the connectivity probe and physical sensor reading'],
    ['NIMIQ_RPC_UNAVAILABLE', 'Retry verification'],
    ['PRIVATE_REPORT_NOT_UNLOCKED', 'confirmed payment'],
  ])('turns %s into an actionable message', (code, expected) => {
    expect(humanizeApiError(code)).toContain(expected)
  })

  it('preserves an unknown server code for diagnosis', () => {
    expect(humanizeApiError('NEW_SERVER_CODE')).toContain('NEW_SERVER_CODE')
  })
})
