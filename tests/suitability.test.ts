import { describe, expect, it } from 'vitest'
import { calculateSuitability } from '../src/lib/suitability'

describe('personal suitability weighting', () => {
  it('normalizes user weights without changing category scores', () => {
    const categories = { connectivity: 80, environmentalComfort: 40 }
    expect(calculateSuitability(categories, { connectivity: 3, environmentalComfort: 1 })).toBe(70)
    expect(categories).toEqual({ connectivity: 80, environmentalComfort: 40 })
  })

  it('excludes missing categories instead of assigning a default score', () => {
    expect(calculateSuitability({ connectivity: 80 }, { connectivity: 1, environmentalComfort: 9 })).toBe(80)
  })

  it('rejects unusable weights', () => {
    expect(() => calculateSuitability({ connectivity: 80 }, { connectivity: 0 })).toThrow('positive weight')
  })
})
