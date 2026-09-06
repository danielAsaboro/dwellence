export function calculateSuitability(
  categories: Partial<Record<'connectivity' | 'environmentalComfort', number>>,
  weights: Partial<Record<'connectivity' | 'environmentalComfort', number>>,
) {
  const available = Object.entries(categories).filter((entry): entry is ['connectivity' | 'environmentalComfort', number] => Number.isFinite(entry[1]))
  const weighted = available.map(([category, score]) => ({ score, weight: Number(weights[category] ?? 0) })).filter(({ weight }) => Number.isFinite(weight) && weight > 0)
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) throw new Error('At least one available category needs a positive weight.')
  return Math.round(weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight)
}
